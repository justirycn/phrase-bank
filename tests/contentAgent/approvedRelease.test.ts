import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { buildReviewModel, type ReviewState } from "../../scripts/content-agent/localReview";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";
import {
  assertSafeReleasePaths,
  loadApprovedRelease,
  parseGitStatusPorcelain,
  runApprovedRelease,
  validateApprovedRelease,
} from "../../scripts/content-agent/approvedRelease";

const VERSION = "2026.08.3";
const ALLOWED = [`public/content/system-content-${VERSION}.json`, "app/domain/bundledSystemContent.ts"];
const APPROVED_OUTPUTS: Record<string, string> = {
  [ALLOWED[0]]: "approved candidate bytes\n",
  [ALLOWED[1]]: `export const BUNDLED_SYSTEM_CONTENT_VERSION = "${VERSION}";\n`,
};
const approvedOutputHashes = () => Object.fromEntries(Object.entries(APPROVED_OUTPUTS).map(([path, raw]) => [path, createHash("sha256").update(raw).digest("hex")]));

function approvedReview(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    format: "phrase-bank-local-review",
    version: VERSION,
    candidateSha256: "a".repeat(64),
    sampleSeed: `${VERSION}:manual-review-v1`,
    sampledIds: ["one"],
    items: { one: { decision: "pass", note: "", updatedAt: "2026-08-18T00:00:00.000Z" } },
    approvedAt: "2026-08-18T00:01:00.000Z",
    ...overrides,
  };
}

async function artifactFixture() {
  const root = await mkdtemp(join(tmpdir(), "approved-release-"));
  const content = generateSystemContent();
  const qualityVersion = "qwen-plus-review-v2";
  const candidate = {
    ...content,
    version: VERSION,
    qualityVersion,
    phrases: content.phrases.map((phrase) => ({ ...phrase, contentVersion: VERSION, qualityVersion })),
  };
  const candidateRaw = `${JSON.stringify(candidate, null, 2)}\n`;
  const model = buildReviewModel({ content: candidate, candidateRaw, sampleSeed: `${VERSION}:manual-review-v1` });
  const items: ReviewState["items"] = Object.fromEntries(model.sampledIds.map((id) => [id, { decision: "pass" as const, note: "", updatedAt: "2026-08-18T00:00:00.000Z" }]));
  const review: ReviewState = { ...model.initialState, items, approvedAt: "2026-08-18T00:01:00.000Z" };
  const report = { status: "pass", version: VERSION, ...inspectSystemContent(candidate) };
  const candidatePath = join(root, "candidate.json");
  const reportPath = join(root, "report.json");
  const reviewPath = join(root, "review.json");
  await Promise.all([
    writeFile(candidatePath, candidateRaw),
    writeFile(reportPath, `${JSON.stringify(report)}\n`),
    writeFile(reviewPath, `${JSON.stringify(review)}\n`),
  ]);
  return { root, candidate, candidateRaw, model, review, report, candidatePath, reportPath, reviewPath };
}

describe("approved release artifact gate", () => {
  it("requires an approval bound to the exact version, raw-byte hash, expected sample, and zero issues", () => {
    const base = approvedReview();
    expect(() => validateApprovedRelease({ review: { ...base, approvedAt: undefined }, candidateSha256: base.candidateSha256, version: VERSION, expectedSampledIds: ["one"], validIds: ["one"] })).toThrow(/not approved/i);
    expect(() => validateApprovedRelease({ review: base, candidateSha256: "b".repeat(64), version: VERSION, expectedSampledIds: ["one"], validIds: ["one"] })).toThrow(/hash/i);
    expect(() => validateApprovedRelease({ review: base, candidateSha256: base.candidateSha256, version: "2026.08.4", expectedSampledIds: ["one"], validIds: ["one"] })).toThrow(/version/i);
    expect(() => validateApprovedRelease({ review: base, candidateSha256: base.candidateSha256, version: VERSION, expectedSampledIds: ["two"], validIds: ["one", "two"] })).toThrow(/sample/i);
    const issue = approvedReview({ items: { ...base.items, outside: { decision: "issue", note: "fix", updatedAt: "2026-08-18T00:00:00.000Z" } } });
    expect(() => validateApprovedRelease({ review: issue, candidateSha256: base.candidateSha256, version: VERSION, expectedSampledIds: ["one"], validIds: ["one", "outside"] })).toThrow(/issue/i);
  });

  it("strictly loads candidate, recomputed report, and persisted review with an exact raw-byte SHA", async () => {
    const files = await artifactFixture();
    const loaded = await loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath });
    expect(loaded.candidateSha256).toBe(createHash("sha256").update(Buffer.from(files.candidateRaw)).digest("hex"));
    expect(loaded.expectedSampledIds).toEqual(files.model.sampledIds);
    expect(loaded.report).toEqual(files.report);
  });

  it("rejects duplicate JSON keys, report drift, review drift, BOMs, and invalid UTF-8", async () => {
    const files = await artifactFixture();
    await writeFile(files.reportPath, JSON.stringify({ ...files.report, totalCount: 1999 }));
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/report/i);
    await writeFile(files.reportPath, `${JSON.stringify(files.report).replace('"status":"pass"', '"status":"pass","status":"pass"')}\n`);
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/duplicate/i);
    await writeFile(files.reportPath, JSON.stringify(files.report));
    await writeFile(files.reviewPath, `${JSON.stringify(files.review).replace('"format":"phrase-bank-local-review"', '"format":"phrase-bank-local-review","format":"phrase-bank-local-review"')}\n`);
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/duplicate/i);
    await writeFile(files.reviewPath, JSON.stringify({ ...files.review, sampledIds: [...files.review.sampledIds].reverse() }));
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/sample/i);
    await writeFile(files.candidatePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(files.candidateRaw)]));
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/bom/i);
    await writeFile(files.candidatePath, Buffer.from([0xc3, 0x28]));
    await expect(loadApprovedRelease({ version: VERSION, candidatePath: files.candidatePath, reportPath: files.reportPath, reviewPath: files.reviewPath })).rejects.toThrow(/utf-8/i);
  });

  it("rejects symlinked artifact and output paths", async () => {
    const files = await artifactFixture();
    const linked = join(files.root, "linked-candidate.json");
    await symlink(files.candidatePath, linked, "file");
    await expect(assertSafeReleasePaths(files.root, [{ path: linked, kind: "file" }])).rejects.toThrow(/symbolic|reparse/i);
    const outside = await mkdtemp(join(tmpdir(), "approved-release-outside-"));
    const linkedDirectory = join(files.root, "public");
    await symlink(outside, linkedDirectory, "junction");
    await expect(assertSafeReleasePaths(files.root, [{ path: join(linkedDirectory, "content", "output.json"), kind: "output" }])).rejects.toThrow(/symbolic|reparse/i);
  });
});

describe("Git status parsing", () => {
  it("parses NUL-delimited ordinary, quoted-looking, and rename paths without ambiguity", () => {
    expect(parseGitStatusPorcelain(" M app/domain/bundledSystemContent.ts\0?? public/content/a b.json\0R  new \\\"quoted\\\".json\0old -> literal.json\0")).toEqual([
      { status: " M", path: "app/domain/bundledSystemContent.ts" },
      { status: "??", path: "public/content/a b.json" },
      { status: "R ", path: String.raw`new \"quoted\".json`, originalPath: "old -> literal.json" },
    ]);
    expect(() => parseGitStatusPorcelain(' M "unterminated')).toThrow(/nul/i);
  });
});

function releaseExecutor(options: { dirty?: string; driftAt?: number; pushHead?: string } = {}) {
  const calls: string[][] = [];
  let fetches = 0;
  let committed = false;
  let pushed = false;
  const base = "1".repeat(40);
  const commit = options.pushHead ?? "2".repeat(40);
  const execute = vi.fn(async (...command: string[]) => {
    calls.push(command);
    const key = command.join(" ");
    if (key === "git status --porcelain=v1 -z --untracked-files=all") {
      if (options.dirty !== undefined) return options.dirty;
      const count = calls.filter((value) => value.join(" ") === key).length;
      return count % 3 === 1 ? "" : count % 3 === 2 ? ` M ${ALLOWED[1]}\0?? ${ALLOWED[0]}\0` : `M  ${ALLOWED[1]}\0A  ${ALLOWED[0]}\0`;
    }
    if (key === "git rev-parse --show-toplevel") return `${resolve("release-root")}\n`;
    if (key === "git rev-parse --git-dir") return `${resolve("common/.git/worktrees/release")}\n`;
    if (key === "git rev-parse --git-common-dir") return `${resolve("common/.git")}\n`;
    if (key === "git fetch --no-tags origin main") { fetches += 1; return ""; }
    if (key === "git rev-parse HEAD") return `${committed ? commit : base}\n`;
    if (key === "git rev-parse HEAD^") return `${base}\n`;
    if (key === "git rev-parse origin/main") return `${options.driftAt === fetches ? "9".repeat(40) : base}\n`;
    if (key === "git diff --cached --name-status -z") return `A\0${ALLOWED[0]}\0M\0${ALLOWED[1]}\0`;
    if (key === "git diff-tree --no-commit-id --name-status -r -z HEAD") return `A\0${ALLOWED[0]}\0M\0${ALLOWED[1]}\0`;
    if (command[0] === "git" && command[1] === "show") return APPROVED_OUTPUTS[command[2].slice(command[2].indexOf(":") + 1)] ?? "";
    if (command[0] === "git" && command.includes("commit")) { committed = true; return "created\n"; }
    if (command[0] === "git" && command[1] === "push") { pushed = true; return ""; }
    if (command[0] === "git" && command[1] === "update-ref") { committed = false; return ""; }
    if (command[0] === "git" && command[1] === "rev-list") return "1\n";
    if (key === "git ls-remote --heads origin refs/heads/main") return `${pushed ? commit : base}\trefs/heads/main\n`;
    return "";
  });
  return { execute, calls };
}

describe("approved release orchestration", () => {
  it("fetches first, validates before publishing, runs every gate, stages exact files, commits once, confirms a non-force push, then dispatches", async () => {
    const { execute, calls } = releaseExecutor();
    const events: string[] = [];
    await runApprovedRelease({
      version: VERSION,
      repositoryRoot: resolve("release-root"),
      execute,
      validate: async () => { events.push("validate"); },
      publish: async () => { events.push("publish"); return approvedOutputHashes(); },
      rollback: async () => { events.push("rollback"); },
    });
    const flat = calls.map((call) => call.join(" "));
    expect(flat.indexOf("git fetch --no-tags origin main")).toBeLessThan(flat.indexOf("git rev-parse origin/main"));
    expect(events).toEqual(["validate", "publish"]);
    expect(flat).toEqual(expect.arrayContaining(["npm test", "npm run lint", "npm run build", "git diff --check"]));
    expect(calls).toContainEqual(["git", "add", "--", ...ALLOWED]);
    expect(flat).toContain("git diff --cached --check");
    expect(calls.filter((command) => command[0] === "git" && command.includes("commit"))).toHaveLength(1);
    expect(calls).toContainEqual(["git", "push", "origin", `${"2".repeat(40)}:refs/heads/main`]);
    expect(calls.flat().some((argument) => argument === "-f" || argument.startsWith("--force"))).toBe(false);
    expect(calls.at(-1)).toEqual(["gh", "workflow", "run", "deploy.yml", "--ref", "main"]);
    expect(flat.filter((value) => value === "git fetch --no-tags origin main")).toHaveLength(3);
    expect(flat.indexOf("git ls-remote --heads origin refs/heads/main")).toBeLessThan(flat.indexOf("gh workflow run deploy.yml --ref main"));
  });

  it("rejects dirt, a non-isolated worktree, and initial branch drift before validation or publishing", async () => {
    for (const mutation of ["dirty", "common", "drift"] as const) {
      const setup = releaseExecutor(mutation === "dirty" ? { dirty: "R  renamed.json\0old.json\0" } : mutation === "drift" ? { driftAt: 1 } : {});
      if (mutation === "common") setup.execute.mockImplementationOnce(async () => "").mockImplementationOnce(async () => `${resolve("release-root")}\n`).mockImplementationOnce(async () => `${resolve("same/.git")}\n`).mockImplementationOnce(async () => `${resolve("same/.git")}\n`);
      const validate = vi.fn(async () => undefined);
      const publish = vi.fn(async () => approvedOutputHashes());
      await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: setup.execute, validate, publish, rollback: vi.fn() })).rejects.toThrow();
      expect(validate).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(setup.calls.some(([program, action]) => program === "git" && (action === "commit" || action === "push"))).toBe(false);
      expect(setup.calls.some(([program]) => program === "gh")).toBe(false);
    }
  });

  it("stops on failures, rolls published files back before any commit, and never dispatches", async () => {
    const { execute, calls } = releaseExecutor({ dirty: "" });
    const rollback = vi.fn(async () => undefined);
    execute.mockImplementation(async (...command: string[]) => {
      calls.push(command);
      const key = command.join(" ");
      if (key === "git status --porcelain=v1 -z --untracked-files=all") return calls.filter((value) => value.join(" ") === key).length === 1 ? "" : ` M ${ALLOWED[1]}\0?? ${ALLOWED[0]}\0`;
      if (key === "git rev-parse --show-toplevel") return `${resolve("release-root")}\n`;
      if (key === "git rev-parse --git-dir") return `${resolve("common/.git/worktrees/release")}\n`;
      if (key === "git rev-parse --git-common-dir") return `${resolve("common/.git")}\n`;
      if (key === "git rev-parse HEAD" || key === "git rev-parse origin/main") return `${"1".repeat(40)}\n`;
      if (key === "npm run lint") throw new Error("lint failed");
      return "";
    });
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback })).rejects.toThrow(/lint failed/);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(calls.some(([program, action]) => program === "git" && (action === "commit" || action === "push"))).toBe(false);
    expect(calls.some(([program]) => program === "gh")).toBe(false);
  });

  it("rolls back a partially failing publisher and unstages exact outputs after a cached gate failure", async () => {
    const partial = releaseExecutor();
    const partialRollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({
      version: VERSION,
      repositoryRoot: resolve("release-root"),
      execute: partial.execute,
      validate: vi.fn(),
      publish: async () => { throw new Error("partial publish"); },
      rollback: partialRollback,
    })).rejects.toThrow(/partial publish/);
    expect(partialRollback).toHaveBeenCalledTimes(1);
    expect(partial.calls.some(([program, action]) => program === "git" && (action === "commit" || action === "push"))).toBe(false);

    const staged = releaseExecutor();
    const original = staged.execute.getMockImplementation()!;
    staged.execute.mockImplementation(async (...command: string[]) => {
      if (command.join(" ") === "git diff --cached --name-status -z") return `A\0${ALLOWED[0]}\0A\0extra.txt\0`;
      return original(...command);
    });
    const stagedRollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: staged.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: stagedRollback })).rejects.toThrow(/cached/i);
    expect(staged.calls).toContainEqual(["git", "restore", "--staged", "--", ...ALLOWED]);
    expect(stagedRollback).toHaveBeenCalledTimes(1);
    expect(staged.calls.some(([program]) => program === "gh")).toBe(false);
  });

  it("stops on main drift immediately before staging or pushing and never dispatches", async () => {
    for (const driftAt of [2, 3]) {
      const { execute, calls } = releaseExecutor({ driftAt });
      await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).rejects.toThrow(/main.*changed|drift/i);
      expect(calls.some(([program]) => program === "gh")).toBe(false);
      if (driftAt === 2) expect(calls.some(([program, action]) => program === "git" && action === "commit")).toBe(false);
      if (driftAt === 3) expect(calls.some(([program, action]) => program === "git" && action === "push")).toBe(false);
    }
  });

  it("rejects extra output, rename output, cached drift, extra commits, and unconfirmed push", async () => {
    const scenarios = [
      ["extra", (execute: ReturnType<typeof vi.fn>) => execute.mockImplementationOnce(async () => "")],
      ["rename", undefined],
      ["cached", undefined],
      ["commits", undefined],
      ["push", undefined],
    ] as const;
    for (const [scenario] of scenarios) {
      const base = releaseExecutor();
      const original = base.execute.getMockImplementation()!;
      base.execute.mockImplementation(async (...command: string[]) => {
        const key = command.join(" ");
        const statusCount = base.calls.filter((value) => value.join(" ") === "git status --porcelain=v1 -z --untracked-files=all").length;
        if (scenario === "extra" && key === "git status --porcelain=v1 -z --untracked-files=all" && statusCount >= 1) return ` M ${ALLOWED[1]}\0?? ${ALLOWED[0]}\0?? extra.txt\0`;
        if (scenario === "rename" && key === "git status --porcelain=v1 -z --untracked-files=all" && statusCount >= 1) return `R  ${ALLOWED[1]}\0old.ts\0?? ${ALLOWED[0]}\0`;
        if (scenario === "cached" && key === "git diff --cached --name-status -z") return `A\0${ALLOWED[0]}\0A\0extra.txt\0`;
        if (scenario === "commits" && command[0] === "git" && command[1] === "rev-list") return "2\n";
        if (scenario === "push" && key === "git ls-remote --heads origin refs/heads/main") return `${"8".repeat(40)}\trefs/heads/main\n`;
        return original(...command);
      });
      await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).rejects.toThrow();
      expect(base.calls.some(([program]) => program === "gh")).toBe(false);
    }
  });

  it("rejects unstaged drift after staging and commit-hook changes before push", async () => {
    const unstaged = releaseExecutor();
    const unstagedOriginal = unstaged.execute.getMockImplementation()!;
    let statusCalls = 0;
    unstaged.execute.mockImplementation(async (...command: string[]) => {
      if (command.join(" ") === "git status --porcelain=v1 -z --untracked-files=all" && ++statusCalls === 3) {
        return `MM ${ALLOWED[1]}\0AM ${ALLOWED[0]}\0`;
      }
      return unstagedOriginal(...command);
    });
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: unstaged.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).rejects.toThrow(/staging|worktree/i);
    expect(unstaged.calls.some(([program, action]) => program === "git" && action === "commit")).toBe(false);

    const hooked = releaseExecutor();
    const hookedOriginal = hooked.execute.getMockImplementation()!;
    hooked.execute.mockImplementation(async (...command: string[]) => {
      if (command.join(" ") === "git diff-tree --no-commit-id --name-status -r -z HEAD") return `A\0${ALLOWED[0]}\0A\0extra.txt\0`;
      return hookedOriginal(...command);
    });
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: hooked.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).rejects.toThrow(/commit/i);
    expect(hooked.calls.some(([program, action]) => program === "git" && action === "push")).toBe(false);
    expect(hooked.calls.some(([program]) => program === "gh")).toBe(false);
  });

  it("disables commit hooks, verifies approved committed bytes, and pushes the immutable release SHA", async () => {
    const base = releaseExecutor();
    await runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() });
    const commit = base.calls.find((command) => command.includes("commit"));
    expect(commit).toEqual(["git", "-c", expect.stringMatching(/^core\.hooksPath=.+/u), "commit", "-m", `content: publish Qwen phrase library ${VERSION}`]);
    expect(base.calls).toContainEqual(["git", "show", `${"2".repeat(40)}:${ALLOWED[0]}`]);
    expect(base.calls).toContainEqual(["git", "show", `${"2".repeat(40)}:${ALLOWED[1]}`]);
    expect(base.calls).toContainEqual(["git", "push", "origin", `${"2".repeat(40)}:refs/heads/main`]);
    expect(base.calls.flat().some((argument) => argument === "-f" || argument.startsWith("--force"))).toBe(false);
    expect(base.calls).not.toContainEqual(["git", "push", "origin", "HEAD:main"]);
  });

  it("rejects a committed allowed file whose bytes differ from the approved publish snapshot", async () => {
    const base = releaseExecutor();
    const original = base.execute.getMockImplementation()!;
    base.execute.mockImplementation(async (...command: string[]) => {
      if (command[0] === "git" && command[1] === "show" && command[2].endsWith(`:${ALLOWED[0]}`)) return "hook-mutated bytes\n";
      return original(...command);
    });
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).rejects.toThrow(/approved|bytes|hash/i);
    expect(base.calls.some(([program, action]) => program === "git" && action === "push")).toBe(false);
    expect(base.calls.some(([program]) => program === "gh")).toBe(false);
  });

  it("safely rolls a pre-push failure back for retry only while HEAD and remote remain unchanged", async () => {
    const base = releaseExecutor();
    const original = base.execute.getMockImplementation()!;
    base.execute.mockImplementation(async (...command: string[]) => {
      if (command[0] === "git" && command[1] === "push") { base.calls.push(command); throw new Error("pre-push transport failure"); }
      return original(...command);
    });
    const rollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback })).rejects.toThrow(/transport failure/i);
    expect(base.calls).toContainEqual(["git", "update-ref", "HEAD", "1".repeat(40), "2".repeat(40)]);
    expect(base.calls).toContainEqual(["git", "reset", "--mixed", "1".repeat(40), "--", ...ALLOWED]);
    expect(base.calls).not.toContainEqual(["git", "reset", "--mixed", "1".repeat(40)]);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(base.calls.some(([program]) => program === "gh")).toBe(false);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback })).rejects.toThrow(/transport failure/i);
    expect(base.calls.filter(([program, action]) => program === "git" && action === "push")).toHaveLength(2);
    expect(base.calls.filter(([program, action]) => program === "git" && action === "reset")).toHaveLength(2);
    expect(rollback).toHaveBeenCalledTimes(2);
  });

  it("preserves concurrent local state and never rolls back after a confirmed push even if deploy dispatch fails", async () => {
    const concurrent = releaseExecutor({ driftAt: 3 });
    const concurrentOriginal = concurrent.execute.getMockImplementation()!;
    let postCommitHeadReads = 0;
    concurrent.execute.mockImplementation(async (...command: string[]) => {
      if (command.join(" ") === "git rev-parse HEAD" && concurrent.calls.some((call) => call.includes("commit")) && ++postCommitHeadReads > 1) return `${"7".repeat(40)}\n`;
      return concurrentOriginal(...command);
    });
    const concurrentRollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: concurrent.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: concurrentRollback })).rejects.toThrow();
    expect(concurrent.calls.some(([program, action]) => program === "git" && action === "reset")).toBe(false);
    expect(concurrentRollback).not.toHaveBeenCalled();

    const remoteDrift = releaseExecutor({ driftAt: 3 });
    const remoteDriftOriginal = remoteDrift.execute.getMockImplementation()!;
    remoteDrift.execute.mockImplementation(async (...command: string[]) => command.join(" ") === "git ls-remote --heads origin refs/heads/main"
      ? `${"9".repeat(40)}\trefs/heads/main\n`
      : remoteDriftOriginal(...command));
    const remoteRollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: remoteDrift.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: remoteRollback })).rejects.toThrow(/main.*changed|drift/i);
    expect(remoteDrift.calls.some(([program, action]) => program === "git" && action === "reset")).toBe(false);
    expect(remoteRollback).not.toHaveBeenCalled();

    const dispatched = releaseExecutor();
    const dispatchedOriginal = dispatched.execute.getMockImplementation()!;
    dispatched.execute.mockImplementation(async (...command: string[]) => {
      if (command[0] === "gh") throw new Error("dispatch failed");
      return dispatchedOriginal(...command);
    });
    const dispatchedRollback = vi.fn(async () => undefined);
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root"), execute: dispatched.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: dispatchedRollback })).rejects.toThrow(/dispatch failed/);
    expect(dispatched.calls.some(([program, action]) => program === "git" && action === "reset")).toBe(false);
    expect(dispatchedRollback).not.toHaveBeenCalled();
  });

  it("compares canonical Windows worktree roots case-insensitively", async () => {
    const base = releaseExecutor();
    await expect(runApprovedRelease({ version: VERSION, repositoryRoot: resolve("release-root").toUpperCase(), execute: base.execute, validate: vi.fn(), publish: async () => approvedOutputHashes(), rollback: vi.fn() })).resolves.toBeUndefined();
  });

  it("disables a real mutating commit hook and safely restores a linked worktree after a simulated push failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "approved-release-git-"));
    const repository = join(root, "repository");
    const origin = join(root, "origin.git");
    const worktree = join(root, "release");
    const execFile = promisify(nodeExecFile);
    const git = async (cwd: string, ...args: string[]) => (await execFile("git", args, { cwd, encoding: "utf8", windowsHide: true })).stdout;
    try {
      await mkdir(join(repository, "app/domain"), { recursive: true });
      await mkdir(join(repository, "public/content"), { recursive: true });
      await git(root, "init", "--initial-branch=main", repository);
      await git(repository, "config", "user.name", "Release Test");
      await git(repository, "config", "user.email", "release-test@example.invalid");
      await writeFile(join(repository, ".gitignore"), ".content-agent/\n");
      await writeFile(join(repository, "app/domain/bundledSystemContent.ts"), "baseline module\n");
      await writeFile(join(repository, "public/content/.gitkeep"), "");
      await git(repository, "add", ".gitignore", "app/domain/bundledSystemContent.ts", "public/content/.gitkeep");
      await git(repository, "commit", "-m", "base");
      await git(root, "clone", "--bare", repository, origin);
      await git(repository, "remote", "add", "origin", origin);
      await git(repository, "fetch", "origin", "main");
      await git(repository, "worktree", "add", "-b", "release", worktree, "main");
      const baseHead = (await git(worktree, "rev-parse", "HEAD")).trim();
      const hook = join(repository, ".git/hooks/pre-commit");
      await writeFile(hook, "#!/bin/sh\nprintf 'hook-mutated\\n' > app/domain/bundledSystemContent.ts\ngit add app/domain/bundledSystemContent.ts\nprintf 'ran\\n' > hook-ran.txt\nexit 91\n");
      const hooksPath = join(worktree, ".content-agent/disabled-hooks");
      await mkdir(hooksPath, { recursive: true });
      const calls: string[][] = [];
      const execute = async (...command: string[]) => {
        calls.push(command);
        if (command[0] === "npm") return "";
        if (command[0] === "gh") throw new Error("dispatch must not run");
        if (command[0] === "git" && command[1] === "push") throw new Error("simulated pre-push transport failure");
        if (command[0] !== "git") throw new Error("unexpected program");
        return git(worktree, ...command.slice(1));
      };
      const publicPath = join(worktree, ALLOWED[0]);
      const modulePath = join(worktree, ALLOWED[1]);
      const rollback = vi.fn(async () => {
        await writeFile(modulePath, "baseline module\n");
        await rm(publicPath, { force: true });
      });
      await expect(runApprovedRelease({
        version: VERSION,
        repositoryRoot: worktree,
        hooksPath,
        execute,
        validate: vi.fn(),
        publish: async () => {
          await writeFile(publicPath, APPROVED_OUTPUTS[ALLOWED[0]]);
          await writeFile(modulePath, APPROVED_OUTPUTS[ALLOWED[1]]);
          return approvedOutputHashes();
        },
        rollback,
      })).rejects.toThrow(/simulated pre-push transport failure/);
      expect(calls.some((command) => command[0] === "git" && command[1] === "-c" && command[2] === `core.hooksPath=${hooksPath}`)).toBe(true);
      expect(await readFile(modulePath, "utf8")).toBe("baseline module\n");
      await expect(readFile(join(worktree, "hook-ran.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await git(worktree, "rev-parse", "HEAD")).trim()).toBe(baseHead);
      expect(await git(worktree, "status", "--porcelain", "--untracked-files=all")).toBe("");
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(calls.some(([program]) => program === "gh")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("approved release CLI", () => {
  it("is import-safe and parses exactly one strict version argument", async () => {
    const path = resolve("scripts/release-approved-qwen-content.ts");
    const runner = await import(`${pathToFileURL(path).href}?safe=${Date.now()}`);
    expect(runner.parseApprovedReleaseArguments(["--version", VERSION])).toEqual({ version: VERSION });
    for (const args of [[], ["--version"], ["--version", VERSION, "extra"], ["--version", VERSION, "--version", VERSION], ["--version", "v1"], ["--wat", VERSION]]) {
      expect(() => runner.parseApprovedReleaseArguments(args)).toThrow();
    }
  });

  it("runs npm through the current Node executable and npm_execpath on Windows-safe paths", async () => {
    const runner = await import(`${pathToFileURL(resolve("scripts/release-approved-qwen-content.ts")).href}?npm=${Date.now()}`);
    const execFile = vi.fn(async () => ({ stdout: "ok", stderr: "" }));
    const execute = runner.createReleaseCommandExecutor({ execFile, npmExecPath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", nodeExecPath: "C:\\Program Files\\nodejs\\node.exe" });
    await expect(execute("npm", "run", "lint")).resolves.toBe("ok");
    expect(execFile).toHaveBeenCalledWith("C:\\Program Files\\nodejs\\node.exe", ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "run", "lint"], expect.objectContaining({ windowsHide: true, maxBuffer: 32 * 1024 * 1024 }));
    await expect(runner.createReleaseCommandExecutor({ execFile, npmExecPath: undefined })("npm", "test")).rejects.toThrow(/npm cli/i);
  });

  it("publishes from an immutable approved snapshot instead of re-reading mutable source artifacts", async () => {
    const files = await artifactFixture();
    const runner = await import(`${pathToFileURL(resolve("scripts/release-approved-qwen-content.ts")).href}?snapshot=${Date.now()}`);
    const snapshot = await runner.createApprovedPublishSnapshot({ directory: files.root, candidateRaw: files.candidateRaw, report: files.report });
    await writeFile(files.candidatePath, "{}\n");
    expect(await readFile(snapshot.candidatePath, "utf8")).toBe(files.candidateRaw);
    expect(JSON.parse(await readFile(snapshot.reportPath, "utf8"))).toEqual(files.report);
    await snapshot.cleanup();
    await expect(readFile(snapshot.candidatePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
