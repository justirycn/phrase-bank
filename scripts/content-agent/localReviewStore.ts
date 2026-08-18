import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ReviewItem, ReviewState } from "./localReview";

export interface LocalReviewSeed {
  path: string;
  version: string;
  candidateSha256: string;
  sampleSeed: string;
  sampledIds: string[];
  validIds: string[];
}

export interface SaveReviewDependencies {
  validIds?: readonly string[];
  writeTemp?: (path: string, contents: string, claimIdentity: (identity: { dev: bigint; ino: bigint }) => void) => Promise<void>;
  atomicReplace?: (temporaryPath: string, destinationPath: string) => Promise<void>;
  retryDelay?: (milliseconds: number) => Promise<void>;
  syncDirectory?: (directoryPath: string) => Promise<void>;
  syncCommittedDestination?: (destinationPath: string) => Promise<void>;
  openCommittedDestination?: typeof open;
  platform?: NodeJS.Platform;
}

export interface LocalReviewStore {
  read(): Promise<ReviewState>;
  update(mutator: (current: ReviewState) => ReviewState | Promise<ReviewState>): Promise<ReviewState>;
}

export interface CanonicalLocalReviewPath {
  physicalPath: string;
  queueKey: string;
}

const FORMAT = "phrase-bank-local-review";
const SEED_KEYS = new Set(["path", "version", "candidateSha256", "sampleSeed", "sampledIds", "validIds"]);
const STATE_KEYS = new Set(["format", "version", "candidateSha256", "sampleSeed", "sampledIds", "items", "approvedAt"]);
const ITEM_KEYS = new Set(["decision", "note", "updatedAt"]);
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVIEW_REPLACE_ATTEMPTS = 5;
const PATH_QUEUES = new Map<string, Promise<void>>();

interface OwnedTempIdentity {
  dev: bigint;
  ino: bigint;
}

function record(value: unknown): value is Record<string, unknown> {
  // Persisted JSON records use the ordinary object prototype; null and custom prototypes are rejected.
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && !("toJSON" in value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, required: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key));
}

function unsafeNoteControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
  });
}

function validId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return false;
  return ![...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function assertUniqueNonemptyIds(value: unknown, label: string, allowEmpty: boolean): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some((id) => !validId(id))
    || new Set(value).size !== value.length) {
    throw new Error(`${label} must contain ${allowEmpty ? "unique" : "nonempty unique"} IDs`);
  }
}

function validateSeed(seed: LocalReviewSeed): void {
  if (!record(seed) || !exactKeys(seed, SEED_KEYS, ["path", "version", "candidateSha256", "sampleSeed", "sampledIds", "validIds"])) {
    throw new Error("Review seed has an invalid shape");
  }
  if (typeof seed.path !== "string" || seed.path.length === 0) throw new Error("Review path must be nonempty");
  if (typeof seed.version !== "string" || !VERSION.test(seed.version)) throw new Error("Review version has an invalid format");
  if (typeof seed.candidateSha256 !== "string" || !SHA256.test(seed.candidateSha256)) throw new Error("Candidate hash must be lowercase SHA-256");
  if (typeof seed.sampleSeed !== "string" || seed.sampleSeed.length === 0 || unsafeNoteControl(seed.sampleSeed)) throw new Error("Sample seed must be nonempty and safe");
  assertUniqueNonemptyIds(seed.validIds, "Valid IDs", false);
  assertUniqueNonemptyIds(seed.sampledIds, "Sample IDs", false);
  const validIds = new Set(seed.validIds);
  if (seed.sampledIds.some((id) => !validIds.has(id))) throw new Error("Sample IDs must be a subset of valid IDs");
}

function validateIdentityFields(value: Record<string, unknown>): void {
  if (typeof value.version !== "string" || !VERSION.test(value.version)
    || typeof value.candidateSha256 !== "string" || !SHA256.test(value.candidateSha256)
    || typeof value.sampleSeed !== "string" || value.sampleSeed.length === 0 || unsafeNoteControl(value.sampleSeed)) {
    throw new Error("Persisted review state has malformed identity fields");
  }
  assertUniqueNonemptyIds(value.sampledIds, "Persisted review state sample", false);
}

function validateState(value: unknown): asserts value is ReviewState {
  if (!record(value) || !exactKeys(value, STATE_KEYS, ["format", "version", "candidateSha256", "sampleSeed", "sampledIds", "items"])) {
    throw new Error("Review state has an invalid top-level shape");
  }
  if (value.format !== FORMAT) throw new Error("Review state has an invalid format");
  validateIdentityFields(value);
  if (!record(value.items)) throw new Error("Review state items must be a record");
  for (const [id, item] of Object.entries(value.items)) {
    if (!validId(id)) throw new Error("Review state contains an invalid item ID");
    if (!record(item) || !exactKeys(item, ITEM_KEYS, ["decision", "note", "updatedAt"])) {
      throw new Error(`Review state item ${id} has an invalid shape`);
    }
    if (item.decision !== "pass" && item.decision !== "issue") throw new Error(`Review state item ${id} has an invalid decision`);
    if (typeof item.note !== "string" || item.note.length > 1000 || unsafeNoteControl(item.note)) {
      throw new Error(`Review state item ${id} has an invalid note`);
    }
    if (!validIso(item.updatedAt)) throw new Error(`Review state item ${id} has an invalid timestamp`);
  }
  if (Object.hasOwn(value, "approvedAt") && !validIso(value.approvedAt)) throw new Error("Review state has an invalid approval timestamp");
  const review = value as unknown as ReviewState;
  if (typeof review.approvedAt === "string") {
    const undecided = review.sampledIds.find((id) => review.items[id]?.decision !== "pass");
    if (undecided) throw new Error(`Approved review has an undecided sampled ID: ${undecided}`);
    if (Object.values(review.items).some((item) => item.decision === "issue")) {
      throw new Error("Approved review contains an issue decision");
    }
  }
}

function initialState(seed: LocalReviewSeed): ReviewState {
  return {
    format: FORMAT,
    version: seed.version,
    candidateSha256: seed.candidateSha256,
    sampleSeed: seed.sampleSeed,
    sampledIds: [...seed.sampledIds],
    items: {},
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameIdentity(value: Record<string, unknown>, seed: LocalReviewSeed): boolean {
  return value.version === seed.version
    && value.candidateSha256 === seed.candidateSha256
    && value.sampleSeed === seed.sampleSeed
    && Array.isArray(value.sampledIds)
    && sameArray(value.sampledIds as string[], seed.sampledIds);
}

async function defaultWriteTemp(
  path: string,
  contents: string,
  claimIdentity: (identity: OwnedTempIdentity) => void,
): Promise<void> {
  const handle = await open(path, "wx");
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Review temporary file has an invalid type");
    const identity = { dev: metadata.dev, ino: metadata.ino };
    claimIdentity(identity);
    await assertOwnedTempPath(path, identity);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultRetryDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function defaultSyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function defaultSyncCommittedDestination(
  path: string,
  identity: OwnedTempIdentity,
  openCommitted: typeof open,
): Promise<void> {
  // Node cannot request MOVEFILE_WRITE_THROUGH for rename. Reopening read/write and syncing invokes
  // FlushFileBuffers on Windows, the strongest low-latency committed-file primitive Node exposes.
  const handle = await openCommitted(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
      throw new Error("Review committed destination ownership changed");
    }
    await assertOwnedCommittedDestination(path, identity);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parentDirectoriesForCreatedPath(firstCreated: string, targetDirectory: string): string[] {
  const nativeFirst = nativeWindowsPath(firstCreated);
  const first = resolve(nativeFirst);
  const target = resolve(targetDirectory);
  const remainder = relative(first, target);
  if (remainder.startsWith("..") || resolve(first, remainder) !== target) return [dirname(first)];
  const segments = remainder ? remainder.split(/[\\/]/u) : [];
  const parents = [dirname(first)];
  let directory = first;
  for (const segment of segments) {
    parents.push(directory);
    directory = join(directory, segment);
  }
  return parents;
}

async function assertOwnedTempPath(path: string, identity: OwnedTempIdentity): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error("Review temporary file ownership changed", { cause: error });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
    throw new Error("Review temporary file ownership changed");
  }
}

async function assertOwnedCommittedDestination(path: string, identity: OwnedTempIdentity): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw new Error("Review committed destination ownership changed", { cause: error });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
    throw new Error("Review committed destination ownership changed");
  }
}

async function verifyCommittedDestination(path: string, identity: OwnedTempIdentity, contents: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new Error("Review committed destination ownership changed", { cause: error });
  }
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) {
      throw new Error("Review committed destination ownership changed");
    }
    await assertOwnedCommittedDestination(path, identity);
    if (await handle.readFile("utf8") !== contents) throw new Error("Review committed destination contents changed");
  } finally {
    await handle.close();
  }
}

async function removeOwnedTemp(path: string, identity?: OwnedTempIdentity): Promise<void> {
  try {
    if (identity) {
      const metadata = await lstat(path, { bigint: true });
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.dev !== identity.dev || metadata.ino !== identity.ino) return;
    }
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

function serializeCanonicalState(state: ReviewState): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(state, null, 2);
  } catch (error) {
    throw new Error("Review state cannot be serialized safely", { cause: error });
  }
  let canonical: unknown;
  try {
    canonical = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Review state did not produce valid JSON", { cause: error });
  }
  validateState(canonical);
  if (!isDeepStrictEqual(canonical, state)) throw new Error("Review state does not serialize to the same canonical value");
  return `${serialized}\n`;
}

export async function saveReview(path: string, state: ReviewState, dependencies: SaveReviewDependencies = {}): Promise<void> {
  const validIds = dependencies.validIds ? new Set(dependencies.validIds) : undefined;
  if (dependencies.validIds) assertUniqueNonemptyIds(dependencies.validIds, "Valid IDs", false);
  validateState(state);
  if (validIds && Object.keys(state.items).some((id) => !validIds.has(id))) {
    throw new Error("Review state contains an item outside the valid IDs");
  }
  const contents = serializeCanonicalState(state);

  const parent = dirname(path);
  const createdDirectory = await mkdir(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(path)}.pending-${process.pid}-${randomUUID()}`);
  let temporaryIdentity: OwnedTempIdentity | undefined;
  try {
    await (dependencies.writeTemp ?? defaultWriteTemp)(temporaryPath, contents, (identity) => { temporaryIdentity = identity; });
    if (!temporaryIdentity) {
      const metadata = await lstat(temporaryPath, { bigint: true });
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Review temporary file has an invalid type");
      temporaryIdentity = { dev: metadata.dev, ino: metadata.ino };
    }
    const ownedIdentity = temporaryIdentity;
    const platform = dependencies.platform ?? process.platform;
    if (platform !== "win32" && createdDirectory) {
      for (const directory of parentDirectoriesForCreatedPath(createdDirectory, parent)) {
        await (dependencies.syncDirectory ?? defaultSyncDirectory)(directory);
      }
    }
    for (let attempt = 1; ; attempt += 1) {
      await assertOwnedTempPath(temporaryPath, ownedIdentity);
      try {
        await (dependencies.atomicReplace ?? rename)(temporaryPath, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (platform !== "win32" || (code !== "EPERM" && code !== "EACCES") || attempt >= REVIEW_REPLACE_ATTEMPTS) throw error;
        await (dependencies.retryDelay ?? defaultRetryDelay)(10 * 2 ** (attempt - 1));
      }
    }
    await verifyCommittedDestination(path, ownedIdentity, contents);
    if (platform === "win32") {
      if (dependencies.syncCommittedDestination) await dependencies.syncCommittedDestination(path);
      else await defaultSyncCommittedDestination(path, ownedIdentity, dependencies.openCommittedDestination ?? open);
    } else {
      // A sync failure after rename is reported without rollback: the new file may already be durable and is reloaded next time.
      await (dependencies.syncDirectory ?? defaultSyncDirectory)(parent);
    }
    temporaryIdentity = undefined;
  } catch (error) {
    try {
      if (temporaryIdentity) await removeOwnedTemp(temporaryPath, temporaryIdentity);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Review save failed and its owned temporary file could not be cleaned");
    }
    throw error;
  }
}

export async function loadOrCreateReview(seed: LocalReviewSeed): Promise<ReviewState> {
  validateSeed(seed);
  let raw: string;
  try {
    raw = await readFile(seed.path, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
    const created = initialState(seed);
    await saveReview(seed.path, created, { validIds: seed.validIds });
    return structuredClone(created);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Persisted review state is not valid JSON", { cause: error });
  }
  if (!record(parsed)) throw new Error("Persisted review state has an invalid top-level shape");
  validateState(parsed);
  if (!sameIdentity(parsed, seed)) {
    const reset = initialState(seed);
    await saveReview(seed.path, reset, { validIds: seed.validIds });
    return structuredClone(reset);
  }

  const validIds = new Set(seed.validIds);
  if (record(parsed.items) && Object.keys(parsed.items).some((id) => !validIds.has(id))) {
    // A candidate-ID shrink invalidates prior decisions rather than risking approval based on removed content.
    const reset = initialState(seed);
    await saveReview(seed.path, reset, { validIds: seed.validIds });
    return structuredClone(reset);
  }
  return structuredClone(parsed);
}

function immutableClone(state: ReviewState): ReviewState {
  const clone = structuredClone(state);
  Object.freeze(clone.sampledIds);
  for (const item of Object.values(clone.items) as ReviewItem[]) Object.freeze(item);
  Object.freeze(clone.items);
  return Object.freeze(clone);
}

function assertSameIdentity(state: ReviewState, seed: LocalReviewSeed): void {
  if (state.format !== FORMAT || state.version !== seed.version || state.candidateSha256 !== seed.candidateSha256
    || state.sampleSeed !== seed.sampleSeed || !sameArray(state.sampledIds, seed.sampledIds)) {
    throw new Error("Review update cannot change review identity");
  }
}

function nativeWindowsPath(path: string): string {
  if (process.platform !== "win32") return path;
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  if (path.startsWith("\\\\?\\")) return path.slice(4);
  return path;
}

export async function canonicalLocalReviewPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<CanonicalLocalReviewPath> {
  let cursor = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const existingAncestor = await realpath(cursor);
      const physicalPath = resolve(nativeWindowsPath(existingAncestor), ...missingSegments);
      return {
        physicalPath,
        queueKey: platform === "win32" ? physicalPath.toLowerCase() : physicalPath,
      };
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("Review path has no existing filesystem ancestor", { cause: error });
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function enqueuePathOperation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const prior = PATH_QUEUES.get(path) ?? Promise.resolve();
  const pending = prior.then(operation);
  const settled = pending.then(() => undefined, () => undefined);
  PATH_QUEUES.set(path, settled);
  void settled.then(() => {
    if (PATH_QUEUES.get(path) === settled) PATH_QUEUES.delete(path);
  });
  return pending;
}

export async function createLocalReviewStore(
  seed: LocalReviewSeed,
  dependencies: Omit<SaveReviewDependencies, "validIds"> = {},
): Promise<LocalReviewStore> {
  validateSeed(seed);
  const { physicalPath, queueKey } = await canonicalLocalReviewPath(seed.path);
  const storageSeed = { ...seed, path: physicalPath };
  await enqueuePathOperation(queueKey, () => loadOrCreateReview(storageSeed));

  return {
    read() {
      return enqueuePathOperation(queueKey, () => loadOrCreateReview(storageSeed));
    },
    update(mutator) {
      return enqueuePathOperation(queueKey, async () => {
        const current = await loadOrCreateReview(storageSeed);
        const next = await mutator(immutableClone(current));
        validateState(next);
        assertSameIdentity(next, storageSeed);
        await saveReview(storageSeed.path, next, { ...dependencies, validIds: storageSeed.validIds });
        return structuredClone(next);
      });
    },
  };
}
