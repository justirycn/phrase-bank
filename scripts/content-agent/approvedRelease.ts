import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";
import { assertContentVersion } from "./qwenCheckpoint";
import { approveReview, buildReviewModel, type ReviewState } from "./localReview";
import { loadOrCreateReview } from "./localReviewStore";
import { inspectSystemContent } from "./qualityGate";

export interface GitStatusEntry { status: string; path: string; originalPath?: string }
export type ReleaseCommandExecutor = (...command: string[]) => Promise<string>;

interface ApprovedReleaseValidation {
  review: ReviewState;
  candidateSha256: string;
  version: string;
  expectedSampledIds: readonly string[];
  validIds: readonly string[];
}

interface LoadApprovedReleaseOptions {
  version: string;
  candidatePath: string;
  reportPath: string;
  reviewPath: string;
}

interface SafeReleasePath { path: string; kind: "file" | "output" }

interface RunApprovedReleaseOptions {
  version: string;
  repositoryRoot: string;
  execute: ReleaseCommandExecutor;
  validate: () => Promise<void>;
  publish: () => Promise<Record<string, string>>;
  validateRollback?: () => Promise<void>;
  rollback?: () => Promise<void>;
  hooksPath?: string | (() => string);
  platform?: NodeJS.Platform;
}

const SHA = /^[0-9a-f]{40}$/u;
const REPORT_KEYS = new Set(["status", "version", "coreCount", "totalCount", "coreByCategory", "errors"]);

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function duplicateJsonKeys(raw: string): boolean {
  class DuplicateKey extends Error {}
  let index = 0;
  const whitespace = () => { while (/\s/u.test(raw[index] ?? "")) index += 1; };
  const string = (): string => {
    const start = index++;
    while (index < raw.length) {
      if (raw[index] === "\\") { index += 2; continue; }
      if (raw[index++] === "\"") return JSON.parse(raw.slice(start, index)) as string;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const value = (): void => {
    whitespace();
    if (raw[index] === "{") { object(); return; }
    if (raw[index] === "[") { array(); return; }
    if (raw[index] === "\"") { string(); return; }
    const start = index;
    while (index < raw.length && !/[\s,\]}]/u.test(raw[index])) index += 1;
    if (index === start) throw new SyntaxError("Invalid JSON value");
  };
  const object = (): void => {
    index += 1; whitespace();
    if (raw[index] === "}") { index += 1; return; }
    const keys = new Set<string>();
    while (index < raw.length) {
      whitespace();
      if (raw[index] !== "\"") throw new SyntaxError("Invalid JSON object key");
      const key = string();
      if (keys.has(key)) throw new DuplicateKey();
      keys.add(key); whitespace();
      if (raw[index++] !== ":") throw new SyntaxError("Invalid JSON object separator");
      value(); whitespace();
      if (raw[index] === "}") { index += 1; return; }
      if (raw[index++] !== ",") throw new SyntaxError("Invalid JSON object delimiter");
    }
    throw new SyntaxError("Unterminated JSON object");
  };
  const array = (): void => {
    index += 1; whitespace();
    if (raw[index] === "]") { index += 1; return; }
    while (index < raw.length) {
      value(); whitespace();
      if (raw[index] === "]") { index += 1; return; }
      if (raw[index++] !== ",") throw new SyntaxError("Invalid JSON array delimiter");
    }
    throw new SyntaxError("Unterminated JSON array");
  };
  try { value(); whitespace(); if (index !== raw.length) throw new SyntaxError("Trailing JSON data"); return false; }
  catch (error) { if (error instanceof DuplicateKey) return true; throw error; }
}

function parseStrictJson(raw: string, label: string): unknown {
  let duplicate = false;
  try { duplicate = duplicateJsonKeys(raw); } catch { throw new Error(`${label} is not valid JSON`); }
  if (duplicate) throw new Error(`${label} contains duplicate JSON keys`);
  try { return JSON.parse(raw) as unknown; } catch { throw new Error(`${label} is not valid JSON`); }
}

function decodeUtf8(bytes: Buffer, label: string): string {
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`${label} must be valid UTF-8`); }
  if (raw.charCodeAt(0) === 0xfeff) throw new Error(`${label} must not contain a UTF-8 BOM`);
  return raw;
}

export function validateApprovedRelease(options: ApprovedReleaseValidation): void {
  const { review, candidateSha256, version, expectedSampledIds, validIds } = options;
  if (!review.approvedAt) throw new Error("Review is not approved");
  if (review.version !== version) throw new Error("Review version does not match the release version");
  if (review.candidateSha256 !== candidateSha256) throw new Error("Review candidate hash has drifted");
  if (!exactArray(review.sampledIds, expectedSampledIds)) throw new Error("Review sample does not match the exact expected sample");
  const valid = new Set(validIds);
  if (Object.keys(review.items).some((id) => !valid.has(id))) throw new Error("Review contains an unknown candidate item");
  if (Object.values(review.items).some(({ decision }) => decision === "issue")) throw new Error("Review contains an unresolved issue");
  approveReview(review, { candidateSha256, version, expectedSampledIds, now: review.approvedAt });
}

export async function loadApprovedRelease(options: LoadApprovedReleaseOptions) {
  const version = assertContentVersion(options.version);
  const candidateBytes = await readFile(options.candidatePath);
  const candidateRaw = decodeUtf8(candidateBytes, "Candidate");
  const parsedCandidate = parseStrictJson(candidateRaw, "Candidate");
  let content: SystemContentPackage;
  try { content = validateSystemContentPackage(parsedCandidate as SystemContentPackage); }
  catch (error) { throw new Error("Candidate is not a valid system content package", { cause: error }); }
  if (content.version !== version) throw new Error("Candidate version does not match the release version");
  const inspection = inspectSystemContent(content);
  if (inspection.errors.length || inspection.coreCount !== 600 || inspection.totalCount !== 2000) throw new Error("Candidate does not pass the recomputed quality gate");
  const sampleSeed = `${version}:manual-review-v1`;
  const model = buildReviewModel({ content, candidateRaw, sampleSeed });
  const candidateSha256 = createHash("sha256").update(candidateBytes).digest("hex");
  if (model.candidateSha256 !== candidateSha256) throw new Error("Candidate raw-byte hash does not match the review model hash");

  const reportRaw = decodeUtf8(await readFile(options.reportPath), "Quality report");
  const report = parseStrictJson(reportRaw, "Quality report");
  const expectedReport = { status: "pass", version, ...inspection };
  if (!plainRecord(report) || Object.keys(report).length !== REPORT_KEYS.size
    || Object.keys(report).some((key) => !REPORT_KEYS.has(key)) || !isDeepStrictEqual(report, expectedReport)) {
    throw new Error("Quality report does not exactly match the recomputed candidate inspection");
  }

  const reviewRaw = decodeUtf8(await readFile(options.reviewPath), "Review state");
  const parsedReview = parseStrictJson(reviewRaw, "Review state");
  const validationRoot = await mkdtemp(join(dirname(options.reviewPath), ".approved-review-validation-"));
  const validationPath = join(validationRoot, "review.json");
  let review: ReviewState;
  try {
    await writeFile(validationPath, reviewRaw, { encoding: "utf8", flag: "wx" });
    review = await loadOrCreateReview({
      path: validationPath,
      version,
      candidateSha256,
      sampleSeed,
      sampledIds: model.sampledIds,
      validIds: model.allIds,
    });
  } finally {
    await rm(validationRoot, { recursive: true, force: true });
  }
  if (!isDeepStrictEqual(review, parsedReview)) throw new Error("Review identity or sample does not exactly match the candidate");
  validateApprovedRelease({ review, candidateSha256, version, expectedSampledIds: model.sampledIds, validIds: model.allIds });
  return { content, candidateRaw, candidateSha256, expectedSampledIds: model.sampledIds, report, review };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export async function assertSafeReleasePaths(root: string, paths: readonly SafeReleasePath[]): Promise<void> {
  const absoluteRoot = resolve(root);
  const physicalRoot = await realpath(absoluteRoot);
  for (const item of paths) {
    const absolute = resolve(item.path);
    const remainder = relative(absoluteRoot, absolute);
    if (remainder === "" || remainder.startsWith("..") || isAbsolute(remainder)) throw new Error("Release path escapes the repository root");
    let cursor = absoluteRoot;
    const segments = remainder.split(/[\\/]/u);
    for (const [index, segment] of segments.entries()) {
      cursor = join(cursor, segment);
      try {
        const metadata = await lstat(cursor);
        if (metadata.isSymbolicLink()) throw new Error("Release path contains a symbolic link or reparse point");
        const last = index === segments.length - 1;
        if (!last && !metadata.isDirectory()) throw new Error("Release path parent is not a directory");
        if (last && item.kind === "file" && !metadata.isFile()) throw new Error("Release artifact is not a regular file");
        if (last && item.kind === "output" && !metadata.isFile()) throw new Error("Existing release output is not a regular file");
        const physical = await realpath(cursor);
        const physicalRemainder = relative(physicalRoot, physical);
        if (physicalRemainder.startsWith("..") || isAbsolute(physicalRemainder)) throw new Error("Release path resolves outside the repository root");
      } catch (error) {
        if (hasErrorCode(error, "ENOENT") && item.kind === "output") break;
        throw error;
      }
    }
  }
}

export function parseGitStatusPorcelain(raw: string): GitStatusEntry[] {
  if (raw === "") return [];
  if (!raw.endsWith("\0")) throw new Error("Git status must use NUL-delimited porcelain output");
  const fields = raw.slice(0, -1).split("\0");
  const result: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field.length < 4 || field[2] !== " ") throw new Error("Git status porcelain entry is malformed");
    const status = field.slice(0, 2);
    const path = field.slice(3);
    if (!path) throw new Error("Git status path is empty");
    if (/[RC]/u.test(status)) {
      const originalPath = fields[++index];
      if (!originalPath) throw new Error("Git rename status is missing its original path");
      result.push({ status, path, originalPath });
    } else result.push({ status, path });
  }
  return result;
}

function parseCachedNameStatus(raw: string): GitStatusEntry[] {
  if (raw === "") return [];
  if (!raw.endsWith("\0")) throw new Error("Cached diff must use NUL delimiters");
  const fields = raw.slice(0, -1).split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const path = fields[index++];
    if (!status || !path) throw new Error("Cached diff entry is malformed");
    if (/^[RC]/u.test(status)) {
      const originalPath = fields[index++];
      if (!originalPath) throw new Error("Cached rename is missing its original path");
      entries.push({ status, path, originalPath });
    } else entries.push({ status, path });
  }
  return entries;
}

function exactAllowedChanges(entries: readonly GitStatusEntry[], allowed: readonly string[]): boolean {
  return entries.length === allowed.length
    && new Set(entries.map(({ path }) => path)).size === allowed.length
    && allowed.every((path) => entries.some((entry) => entry.path === path))
    && entries.every(({ status, originalPath }) => !originalPath && !/[DRCU]/u.test(status));
}

function exactPublishedWorktree(entries: readonly GitStatusEntry[], allowed: readonly string[], staged: boolean): boolean {
  return exactAllowedChanges(entries, allowed) && entries.every(({ status }) => staged
    ? status[0] !== " " && status[1] === " " && status !== "??"
    : status === "??" || (status[0] === " " && status[1] !== " "));
}

function checkedSha(value: string, label: string): string {
  const sha = value.trim();
  if (!SHA.test(sha)) throw new Error(`${label} did not return a full Git SHA`);
  return sha;
}

function comparablePath(path: string, platform: NodeJS.Platform): string {
  const normalized = resolve(path).replace(/^\\\\\?\\UNC\\/iu, "\\\\").replace(/^\\\\\?\\/u, "");
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

async function canonicalComparablePath(path: string, platform: NodeJS.Platform): Promise<string> {
  try { return comparablePath(await realpath(resolve(path)), platform); }
  catch (error) {
    if (hasErrorCode(error, "ENOENT")) return comparablePath(path, platform);
    throw error;
  }
}

function remoteMainSha(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const [sha, reference, ...extra] = trimmed.split(/\s+/u);
  if (extra.length || reference !== "refs/heads/main" || !SHA.test(sha)) throw new Error("Remote main lookup returned an invalid result");
  return sha;
}

export async function runApprovedRelease(options: RunApprovedReleaseOptions): Promise<void> {
  const version = assertContentVersion(options.version);
  const allowed = [`public/content/system-content-${version}.json`, "app/domain/bundledSystemContent.ts"];
  const platform = options.platform ?? process.platform;
  const initialStatus = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
  if (initialStatus.length) throw new Error("Release worktree must start completely clean");
  const topLevel = resolve((await options.execute("git", "rev-parse", "--show-toplevel")).trim());
  if (await canonicalComparablePath(topLevel, platform) !== await canonicalComparablePath(options.repositoryRoot, platform)) {
    throw new Error("Release command is not running at the expected worktree root");
  }
  const gitDirectory = resolve(topLevel, (await options.execute("git", "rev-parse", "--git-dir")).trim());
  const commonDirectory = resolve(topLevel, (await options.execute("git", "rev-parse", "--git-common-dir")).trim());
  const comparableGitDirectory = await canonicalComparablePath(gitDirectory, platform);
  const comparableCommonDirectory = await canonicalComparablePath(commonDirectory, platform);
  if (comparableGitDirectory === comparableCommonDirectory
    || !relative(comparableCommonDirectory, comparableGitDirectory).split(/[\\/]/u).includes("worktrees")) {
    throw new Error("Release command requires an isolated linked Git worktree");
  }
  await options.execute("git", "fetch", "--no-tags", "origin", "main");
  const baseHead = checkedSha(await options.execute("git", "rev-parse", "HEAD"), "HEAD");
  if (checkedSha(await options.execute("git", "rev-parse", "origin/main"), "origin/main") !== baseHead) {
    throw new Error("Release worktree must start exactly at freshly fetched origin/main");
  }

  let published = false;
  let staged = false;
  let committed = false;
  let releaseHead: string | undefined;
  let pushConfirmed = false;
  try {
    await options.validate();
    const expectedOutputBlobOids = await options.publish();
    published = true;
    if (!plainRecord(expectedOutputBlobOids) || Object.keys(expectedOutputBlobOids).length !== allowed.length
      || allowed.some((path) => !SHA.test(expectedOutputBlobOids[path] ?? ""))) {
      throw new Error("Publisher must return exact Git blob IDs for both approved outputs");
    }
    await options.execute("npm", "test");
    await options.execute("npm", "run", "lint");
    await options.execute("npm", "run", "build");
    await options.execute("git", "diff", "--check");
    const changes = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
    if (!exactAllowedChanges(changes, allowed)) throw new Error("Release may change exactly the two approved content outputs and no other files");

    await options.execute("git", "fetch", "--no-tags", "origin", "main");
    if (checkedSha(await options.execute("git", "rev-parse", "origin/main"), "origin/main") !== baseHead) throw new Error("origin/main changed immediately before staging");
    await options.execute("git", "add", "--", ...allowed);
    staged = true;
    await options.execute("git", "diff", "--cached", "--check");
    const cached = parseCachedNameStatus(await options.execute("git", "diff", "--cached", "--name-status", "-z"));
    if (!exactAllowedChanges(cached, allowed)) throw new Error("Cached release diff does not contain exactly the approved outputs");
    const stagedStatus = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
    if (!exactAllowedChanges(stagedStatus, allowed) || stagedStatus.some(({ status }) => status[0] === " " || status[1] !== " " || status === "??")) {
      throw new Error("Release worktree changed after exact-file staging");
    }
    const configuredHooksPath = typeof options.hooksPath === "function" ? options.hooksPath() : options.hooksPath;
    const hooksPath = resolve(configuredHooksPath ?? join(options.repositoryRoot, ".content-agent/disabled-release-hooks"));
    await options.execute("git", "-c", `core.hooksPath=${hooksPath}`, "commit", "-m", `content: publish Qwen phrase library ${version}`);
    committed = true;
    releaseHead = checkedSha(await options.execute("git", "rev-parse", "HEAD"), "release HEAD");
    if (releaseHead === baseHead || checkedSha(await options.execute("git", "rev-parse", "HEAD^"), "release parent") !== baseHead
      || (await options.execute("git", "rev-list", "--count", `${baseHead}..HEAD`)).trim() !== "1") {
      throw new Error("Release must create exactly one commit on origin/main");
    }
    await options.execute("git", "diff-tree", "--check", "HEAD^", "HEAD");
    const committedChanges = parseCachedNameStatus(await options.execute("git", "diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "HEAD"));
    if (!exactAllowedChanges(committedChanges, allowed)) throw new Error("Release commit does not contain exactly the two approved outputs");
    for (const path of allowed) {
      const committedBlob = checkedSha(await options.execute("git", "rev-parse", `${releaseHead}:${path}`), `release blob ${path}`);
      if (committedBlob !== expectedOutputBlobOids[path]) {
        throw new Error(`Release commit bytes do not match the approved output: ${path}`);
      }
    }
    await options.execute("git", "fetch", "--no-tags", "origin", "main");
    if (checkedSha(await options.execute("git", "rev-parse", "origin/main"), "origin/main") !== baseHead) throw new Error("origin/main changed immediately before push");
    await options.execute("git", "-c", `core.hooksPath=${hooksPath}`, "push", "origin", `${releaseHead}:refs/heads/main`);
    const remote = remoteMainSha(await options.execute("git", "ls-remote", "--heads", "origin", "refs/heads/main"));
    if (remote !== releaseHead) throw new Error("Push could not be confirmed on origin/main");
    pushConfirmed = true;
    await options.execute("gh", "workflow", "run", "deploy.yml", "--ref", "main", "-f", `approved_sha=${releaseHead}`);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (staged && !committed) {
      try {
        const state = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
        if (!exactPublishedWorktree(state, allowed, true)) throw new Error("Refusing cleanup because the staged release state drifted");
        await options.validateRollback?.();
        await options.execute("git", "restore", "--staged", "--", ...allowed);
      }
      catch (unstageError) { cleanupErrors.push(unstageError); }
    }
    if (published && !committed && options.rollback) {
      try {
        const state = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
        if (!exactPublishedWorktree(state, allowed, false)) throw new Error("Refusing cleanup because the published release state drifted");
        await options.validateRollback?.();
        await options.rollback();
      }
      catch (rollbackError) { cleanupErrors.push(rollbackError); }
    }
    if (committed && !pushConfirmed && releaseHead && options.rollback) {
      try {
        const state = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
        if (state.length) throw new Error("Refusing cleanup because the committed worktree or index drifted");
        await options.validateRollback?.();
        const currentHead = checkedSha(await options.execute("git", "rev-parse", "HEAD"), "rollback HEAD");
        const currentRemote = remoteMainSha(await options.execute("git", "ls-remote", "--heads", "origin", "refs/heads/main"));
        if (currentHead === releaseHead && currentRemote === baseHead) {
          await options.execute("git", "update-ref", "HEAD", baseHead, releaseHead);
          const resetCandidate = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
          if (!exactPublishedWorktree(resetCandidate, allowed, true)) throw new Error("Refusing cleanup because the index or worktree drifted after HEAD rollback");
          await options.validateRollback?.();
          await options.execute("git", "reset", "--mixed", baseHead, "--", ...allowed);
          const rollbackCandidate = parseGitStatusPorcelain(await options.execute("git", "status", "--porcelain=v1", "-z", "--untracked-files=all"));
          if (!exactPublishedWorktree(rollbackCandidate, allowed, false)) throw new Error("Refusing cleanup because the worktree drifted after index rollback");
          await options.validateRollback?.();
          await options.rollback();
        }
      } catch (rollbackError) { cleanupErrors.push(rollbackError); }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Release failed and pre-commit cleanup also failed");
    throw error;
  }
}
