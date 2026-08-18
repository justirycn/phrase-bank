import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewState } from "../../scripts/content-agent/localReview";
import {
  canonicalLocalReviewPath,
  createLocalReviewStore,
  loadOrCreateReview,
  saveReview,
  type LocalReviewSeed,
} from "../../scripts/content-agent/localReviewStore";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function fixture(): Promise<{ directory: string; seed: LocalReviewSeed }> {
  const directory = await mkdtemp(join(tmpdir(), "local-review-store-"));
  return {
    directory,
    seed: {
      path: join(directory, ".content-agent", "review-2026.08.18.json"),
      version: "2026.08.18",
      candidateSha256: HASH_A,
      sampleSeed: "release-review",
      sampledIds: ["phrase-1", "phrase-2"],
      validIds: ["phrase-1", "phrase-2", "phrase-3"],
    },
  };
}

async function directoryAlias(directory: string): Promise<string> {
  const aliasRoot = await mkdtemp(join(tmpdir(), "local-review-alias-"));
  const alias = join(aliasRoot, "linked-review-root");
  await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
  return alias;
}

function decided(seed: LocalReviewSeed): ReviewState {
  return {
    format: "phrase-bank-local-review",
    version: seed.version,
    candidateSha256: seed.candidateSha256,
    sampleSeed: seed.sampleSeed,
    sampledIds: [...seed.sampledIds],
    items: {
      "phrase-1": { decision: "pass", note: "checked", updatedAt: "2026-08-18T12:00:00.000Z" },
      "phrase-2": { decision: "pass", note: "checked", updatedAt: "2026-08-18T12:00:00.000Z" },
    },
    approvedAt: "2026-08-18T12:01:00.000Z",
  };
}

function transientReplaceError(code: "EPERM" | "EACCES"): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code} replacement contention`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("loadOrCreateReview", () => {
  it("creates a missing review file with empty decisions and no approval", async () => {
    const { seed } = await fixture();
    const state = await loadOrCreateReview(seed);

    expect(state).toEqual({
      format: "phrase-bank-local-review",
      version: seed.version,
      candidateSha256: HASH_A,
      sampleSeed: seed.sampleSeed,
      sampledIds: seed.sampledIds,
      items: {},
    });
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(state);
  });

  it("preserves a valid review with the same identity", async () => {
    const { seed } = await fixture();
    const state = decided(seed);
    await saveReview(seed.path, state, { validIds: seed.validIds });
    expect(await loadOrCreateReview(seed)).toEqual(state);
  });

  it.each([
    ["candidate hash", (seed: LocalReviewSeed) => ({ ...seed, candidateSha256: HASH_B })],
    ["version", (seed: LocalReviewSeed) => ({ ...seed, version: "2026.08.19" })],
    ["sample seed", (seed: LocalReviewSeed) => ({ ...seed, sampleSeed: "other-seed" })],
    ["sample order", (seed: LocalReviewSeed) => ({ ...seed, sampledIds: [...seed.sampledIds].reverse() })],
  ])("resets decisions and approval after %s drift", async (_label, change) => {
    const { seed } = await fixture();
    await saveReview(seed.path, decided(seed), { validIds: seed.validIds });

    const next = await loadOrCreateReview(change(seed));
    expect(next.items).toEqual({});
    expect(next).not.toHaveProperty("approvedAt");
  });

  it("preserves valid decisions when valid IDs expand", async () => {
    const { seed } = await fixture();
    const state = decided(seed);
    await saveReview(seed.path, state, { validIds: seed.validIds });
    expect(await loadOrCreateReview({ ...seed, validIds: [...seed.validIds, "phrase-4"] })).toEqual(state);
  });

  it("safely resets when valid IDs shrink past a stored decision", async () => {
    const { seed } = await fixture();
    const state = decided(seed);
    state.items["phrase-3"] = state.items["phrase-1"];
    await saveReview(seed.path, state, { validIds: seed.validIds });
    const next = await loadOrCreateReview({ ...seed, validIds: ["phrase-1", "phrase-2"] });
    expect(next.items).toEqual({});
    expect(next).not.toHaveProperty("approvedAt");
  });

  it.each([
    ["unknown top-level field", { extra: true }],
    ["bad format", { format: "other" }],
    ["unknown item field", { items: { "phrase-1": { decision: "pass", note: "", updatedAt: "2026-08-18T12:00:00.000Z", extra: true } } }],
    ["bad decision", { items: { "phrase-1": { decision: "maybe", note: "", updatedAt: "2026-08-18T12:00:00.000Z" } } }],
    ["unsafe note", { items: { "phrase-1": { decision: "pass", note: "bad\u0000", updatedAt: "2026-08-18T12:00:00.000Z" } } }],
    ["long note", { items: { "phrase-1": { decision: "pass", note: "x".repeat(1001), updatedAt: "2026-08-18T12:00:00.000Z" } } }],
    ["bad item timestamp", { items: { "phrase-1": { decision: "pass", note: "", updatedAt: "yesterday" } } }],
    ["bad approval timestamp", { approvedAt: "tomorrow" }],
  ])("rejects same-identity persisted state with a %s", async (_label, mutation) => {
    const { seed } = await fixture();
    const state = { ...decided(seed), ...mutation };
    await mkdir(join(seed.path, ".."), { recursive: true });
    await writeFile(seed.path, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
    await expect(loadOrCreateReview(seed)).rejects.toThrow(/review state/i);
  });

  it.each([
    ["hash drift with an invalid decision", () => ({ candidateSha256: HASH_B, items: { "phrase-1": { decision: "maybe", note: "", updatedAt: "2026-08-18T12:00:00.000Z" } } })],
    ["version drift with an unsafe note", () => ({ version: "2026.08.19", items: { "phrase-1": { decision: "pass", note: "bad\u0000", updatedAt: "2026-08-18T12:00:00.000Z" } } })],
    ["seed drift with an invalid timestamp", () => ({ sampleSeed: "new-seed", items: { "phrase-1": { decision: "pass", note: "", updatedAt: "yesterday" } } })],
    ["sample drift with an unknown field", () => ({ sampledIds: ["phrase-2", "phrase-1"], extra: true })],
  ])("rejects and preserves malformed persisted bytes despite %s", async (_label, mutation) => {
    const { seed } = await fixture();
    const malformed = { ...decided(seed), ...mutation() };
    const bytes = `${JSON.stringify(malformed)}\n`;
    await mkdir(join(seed.path, ".."), { recursive: true });
    await writeFile(seed.path, bytes, "utf8");

    await expect(loadOrCreateReview(seed)).rejects.toThrow(/review state/i);
    expect(await readFile(seed.path, "utf8")).toBe(bytes);
  });

  it("resets a fully valid unknown stored item ID only after validating it", async () => {
    const { seed } = await fixture();
    const state = decided(seed);
    state.items.unknown = state.items["phrase-1"];
    await mkdir(join(seed.path, ".."), { recursive: true });
    await writeFile(seed.path, `${JSON.stringify(state)}\n`, "utf8");
    expect((await loadOrCreateReview(seed)).items).toEqual({});
  });

  it.each([
    [(seed: LocalReviewSeed) => ({ ...seed, version: "bad version" }), /version/i],
    [(seed: LocalReviewSeed) => ({ ...seed, candidateSha256: "abc" }), /hash/i],
    [(seed: LocalReviewSeed) => ({ ...seed, sampledIds: ["a", "a"], validIds: ["a"] }), /sample/i],
    [(seed: LocalReviewSeed) => ({ ...seed, sampledIds: ["a"], validIds: ["b"] }), /sample/i],
    [(seed: LocalReviewSeed) => ({ ...seed, sampledIds: ["a"], validIds: ["a", "a"] }), /valid/i],
    [(seed: LocalReviewSeed) => ({ ...seed, extra: true }) as LocalReviewSeed, /seed/i],
  ])("rejects an invalid seed", async (mutation, message) => {
    const { seed } = await fixture();
    await expect(loadOrCreateReview(mutation(seed))).rejects.toThrow(message);
  });

  it.each([
    ["valid ID padded with whitespace", { validIds: [" phrase-1", "phrase-2"] }],
    ["valid ID containing a tab", { validIds: ["phrase-1\t", "phrase-2"] }],
    ["sample ID containing a newline", { sampledIds: ["phrase-1\n", "phrase-2"], validIds: ["phrase-1\n", "phrase-2"] }],
  ])("rejects a %s", async (_label, mutation) => {
    const { seed } = await fixture();
    await expect(loadOrCreateReview({ ...seed, ...mutation })).rejects.toThrow(/IDs/i);
  });

  it("rejects an unsafe persisted item key before considering valid-ID shrink", async () => {
    const { seed } = await fixture();
    const state = decided(seed);
    state.items = { "phrase-3\n": state.items["phrase-1"] };
    const bytes = `${JSON.stringify(state)}\n`;
    await mkdir(join(seed.path, ".."), { recursive: true });
    await writeFile(seed.path, bytes, "utf8");
    await expect(loadOrCreateReview(seed)).rejects.toThrow(/item ID/i);
    expect(await readFile(seed.path, "utf8")).toBe(bytes);
  });
});

describe("saveReview", () => {
  it("atomically replaces an existing review on this platform", async () => {
    const { seed } = await fixture();
    const first = decided(seed);
    await saveReview(seed.path, first, { validIds: seed.validIds });
    const second = { ...first, approvedAt: "2026-08-18T12:02:00.000Z" };
    await saveReview(seed.path, second, { validIds: seed.validIds });
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(second);
  });

  it.each(["write", "replace"])("preserves prior bytes and cleans only its own temp after %s failure", async (failure) => {
    const { directory, seed } = await fixture();
    await saveReview(seed.path, decided(seed), { validIds: seed.validIds });
    const prior = await readFile(seed.path, "utf8");
    const parent = join(directory, ".content-agent");
    const foreign = join(parent, "review-foreign.pending");
    await writeFile(foreign, "foreign");

    const dependencies = failure === "write"
      ? { validIds: seed.validIds, writeTemp: async (path: string, _contents: string, claimIdentity: (identity: { dev: bigint; ino: bigint }) => void) => {
        await writeFile(path, "partial", { flag: "wx" });
        const metadata = await lstat(path, { bigint: true });
        claimIdentity({ dev: metadata.dev, ino: metadata.ino });
        throw new Error("write failed");
      } }
      : { validIds: seed.validIds, atomicReplace: async () => { throw new Error("replace failed"); } };
    await expect(saveReview(seed.path, { ...decided(seed), approvedAt: "2026-08-18T12:03:00.000Z" }, dependencies)).rejects.toThrow(`${failure} failed`);

    expect(await readFile(seed.path, "utf8")).toBe(prior);
    expect(await readFile(foreign, "utf8")).toBe("foreign");
    expect((await readdir(parent)).filter((name) => name.includes(".pending-"))).toEqual([]);
  });

  it("validates candidate state before touching disk", async () => {
    const { seed } = await fixture();
    await expect(saveReview(seed.path, { ...decided(seed), extra: true } as ReviewState, { validIds: seed.validIds })).rejects.toThrow(/review state/i);
    await expect(readdir(join(seed.path, ".."))).rejects.toThrow();
  });

  it.each([
    ["Date top state", (state: ReviewState) => new Date(state.approvedAt!) as unknown as ReviewState],
    ["Map top state", (state: ReviewState) => new Map(Object.entries(state)) as unknown as ReviewState],
    ["custom-class top state", (state: ReviewState) => Object.assign(new (class ReviewContainer {})(), state) as ReviewState],
    ["Date items record", (state: ReviewState) => ({ ...state, items: new Date() as unknown as ReviewState["items"] })],
    ["Map items record", (state: ReviewState) => ({ ...state, items: new Map() as unknown as ReviewState["items"] })],
    ["custom-class item", (state: ReviewState) => ({
      ...state,
      items: { "phrase-1": Object.assign(new (class ItemContainer {})(), state.items["phrase-1"]) as ReviewState["items"][string] },
    })],
    ["null-prototype top state", (state: ReviewState) => Object.assign(Object.create(null) as ReviewState, state)],
    ["non-enumerable toJSON", (state: ReviewState) => {
      const value = { ...state } as ReviewState & { toJSON?: () => ReviewState };
      Object.defineProperty(value, "toJSON", {
        enumerable: false,
        value: () => ({ ...state, candidateSha256: HASH_B }),
      });
      return value;
    }],
  ])("rejects a %s without touching prior bytes or temporary files", async (_label, mutate) => {
    const { seed } = await fixture();
    const state = decided(seed);
    await saveReview(seed.path, state, { validIds: seed.validIds });
    const priorBytes = await readFile(seed.path, "utf8");
    const parent = join(seed.path, "..");
    const priorNames = await readdir(parent);

    await expect(saveReview(seed.path, mutate(state), { validIds: seed.validIds })).rejects.toThrow(/review state/i);
    expect(await readFile(seed.path, "utf8")).toBe(priorBytes);
    expect(await readdir(parent)).toEqual(priorNames);
  });

  it.each([
    ["empty approved review", (state: ReviewState) => ({ ...state, items: {} })],
    ["undecided sampled ID", (state: ReviewState) => ({ ...state, items: { "phrase-1": state.items["phrase-1"] } })],
    ["issue anywhere", (state: ReviewState) => ({
      ...state,
      items: { ...state.items, "phrase-3": { decision: "issue" as const, note: "problem", updatedAt: "2026-08-18T12:00:00.000Z" } },
    })],
  ])("rejects an %s on save and load without changing persisted bytes", async (_label, invalidate) => {
    const { seed } = await fixture();
    const invalid = invalidate(decided(seed));
    await expect(saveReview(seed.path, invalid, { validIds: seed.validIds })).rejects.toThrow(/approved review/i);

    await mkdir(dirname(seed.path), { recursive: true });
    const bytes = `${JSON.stringify(invalid)}\n`;
    await writeFile(seed.path, bytes, "utf8");
    await expect(loadOrCreateReview(seed)).rejects.toThrow(/approved review/i);
    expect(await readFile(seed.path, "utf8")).toBe(bytes);
  });

  it("syncs the containing directory after replacement on POSIX", async () => {
    const { seed } = await fixture();
    await mkdir(dirname(seed.path), { recursive: true });
    const events: string[] = [];
    await saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      platform: "linux",
      atomicReplace: async (temporaryPath, destinationPath) => {
        events.push("replace");
        await rename(temporaryPath, destinationPath);
      },
      syncDirectory: async (path) => {
        events.push(`sync:${path}`);
      },
    });
    expect(events).toEqual(["replace", `sync:${dirname(seed.path)}`]);
  });

  it("skips containing-directory sync on Windows", async () => {
    const { seed } = await fixture();
    let called = false;
    await saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      platform: "win32",
      syncDirectory: async () => { called = true; },
    });
    expect(called).toBe(false);
  });

  it("syncs the committed destination after replacement on Windows", async () => {
    const { seed } = await fixture();
    const events: string[] = [];
    await saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      platform: "win32",
      atomicReplace: async (temporaryPath, destinationPath) => {
        events.push("replace");
        await rename(temporaryPath, destinationPath);
      },
      syncCommittedDestination: async (path) => { events.push(`sync-file:${path}`); },
    });
    expect(events).toEqual(["replace", `sync-file:${seed.path}`]);
  });

  it("reports committed-destination sync failure after Windows replacement", async () => {
    const { seed } = await fixture();
    const next = decided(seed);
    await expect(saveReview(seed.path, next, {
      validIds: seed.validIds,
      platform: "win32",
      syncCommittedDestination: async () => { throw new Error("committed file sync failed"); },
    })).rejects.toThrow("committed file sync failed");
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(next);
  });

  it("retries transient Windows replacement contention without losing the pending review", async () => {
    const { seed } = await fixture();
    const prior = decided(seed);
    await saveReview(seed.path, prior, { validIds: seed.validIds });
    const next = { ...prior, approvedAt: "2026-08-18T12:03:00.000Z" };
    const attempts: string[] = [];
    const delays: number[] = [];

    await saveReview(seed.path, next, {
      validIds: seed.validIds,
      platform: "win32",
      atomicReplace: async (temporaryPath, destinationPath) => {
        attempts.push(temporaryPath);
        if (attempts.length === 1) throw transientReplaceError("EPERM");
        if (attempts.length === 2) throw transientReplaceError("EACCES");
        await rename(temporaryPath, destinationPath);
      },
      retryDelay: async (milliseconds) => { delays.push(milliseconds); },
      syncCommittedDestination: async () => undefined,
    });

    expect(attempts).toHaveLength(3);
    expect(new Set(attempts).size).toBe(1);
    expect(delays).toEqual([10, 20]);
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(next);
    expect((await readdir(dirname(seed.path))).filter((name) => name.includes(".pending-"))).toEqual([]);
  });

  it("revalidates temporary-file ownership before a Windows replacement retry and never follows or deletes a swapped link", async () => {
    const { seed } = await fixture();
    const prior = decided(seed);
    await saveReview(seed.path, prior, { validIds: seed.validIds });
    const priorBytes = await readFile(seed.path, "utf8");
    const foreignPath = join(dirname(seed.path), "foreign-review.json");
    await writeFile(foreignPath, "foreign bytes", "utf8");
    let pendingPath = "";
    let attempts = 0;

    await expect(saveReview(seed.path, { ...prior, approvedAt: "2026-08-18T12:03:00.000Z" }, {
      validIds: seed.validIds,
      platform: "win32",
      atomicReplace: async (temporaryPath) => {
        pendingPath = temporaryPath;
        attempts += 1;
        throw transientReplaceError("EPERM");
      },
      retryDelay: async () => {
        await rm(pendingPath, { force: true });
        await symlink(foreignPath, pendingPath, "file");
      },
      syncCommittedDestination: async () => undefined,
    })).rejects.toThrow(/ownership|temporary|临时|所有权/i);

    expect(attempts).toBe(1);
    expect(await readFile(seed.path, "utf8")).toBe(priorBytes);
    expect((await lstat(pendingPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe("foreign bytes");
  });

  it("does not delete an unproven foreign link left at the temporary path by a failed writer", async () => {
    const { seed } = await fixture();
    const foreignPath = join(dirname(seed.path), "foreign-write.json");
    await mkdir(dirname(seed.path), { recursive: true });
    await writeFile(foreignPath, "foreign write bytes", "utf8");
    let pendingPath = "";

    await expect(saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      writeTemp: async (path) => {
        pendingPath = path;
        await symlink(foreignPath, path, "file");
        throw new Error("writer lost ownership");
      },
    })).rejects.toThrow("writer lost ownership");

    expect((await lstat(pendingPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe("foreign write bytes");
  });

  it("rejects a foreign destination link swapped in immediately after Windows replacement without following it", async () => {
    const { seed } = await fixture();
    await saveReview(seed.path, decided(seed), { validIds: seed.validIds });
    const foreignPath = join(dirname(seed.path), "foreign-destination.json");
    await writeFile(foreignPath, "foreign destination bytes", "utf8");

    await expect(saveReview(seed.path, { ...decided(seed), approvedAt: "2026-08-18T12:03:00.000Z" }, {
      validIds: seed.validIds,
      platform: "win32",
      atomicReplace: async (temporaryPath, destinationPath) => {
        await rename(temporaryPath, destinationPath);
        await rm(destinationPath, { force: true });
        await symlink(foreignPath, destinationPath, "file");
      },
    })).rejects.toThrow(/ownership|committed|destination|所有权|已提交/i);

    expect((await lstat(seed.path)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe("foreign destination bytes");
  });

  it("uses no-follow read/write open when a destination swap races the Windows durability sync", async () => {
    const { seed } = await fixture();
    const foreignPath = join(dirname(seed.path), "foreign-sync.json");
    await mkdir(dirname(seed.path), { recursive: true });
    await writeFile(foreignPath, "foreign sync bytes", "utf8");
    let flagsSeen: number | string | undefined;

    await expect(saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      platform: "win32",
      openCommittedDestination: (async (path: string, flags: number | string) => {
        flagsSeen = flags;
        await rm(path, { force: true });
        await symlink(foreignPath, path, "file");
        return open(path, flags);
      }) as typeof open,
    })).rejects.toThrow();

    expect(flagsSeen).toBe(constants.O_RDWR | constants.O_NOFOLLOW);
    expect((await lstat(seed.path)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignPath, "utf8")).toBe("foreign sync bytes");
  });

  it("persists a newly created review directory entry before commit and the commit afterward on POSIX", async () => {
    const { directory, seed } = await fixture();
    const events: string[] = [];
    await saveReview(seed.path, decided(seed), {
      validIds: seed.validIds,
      platform: "linux",
      atomicReplace: async (temporaryPath, destinationPath) => {
        events.push("replace");
        await rename(temporaryPath, destinationPath);
      },
      syncDirectory: async (path) => { events.push(`sync-dir:${path}`); },
    });
    expect(events).toEqual([
      `sync-dir:${directory}`,
      "replace",
      `sync-dir:${dirname(seed.path)}`,
    ]);
  });

  it("reports a post-rename directory-sync failure without rolling back new bytes", async () => {
    const { seed } = await fixture();
    const prior = decided(seed);
    await saveReview(seed.path, prior, { validIds: seed.validIds });
    const next = { ...prior, approvedAt: "2026-08-18T12:02:00.000Z" };
    await expect(saveReview(seed.path, next, {
      validIds: seed.validIds,
      platform: "linux",
      syncDirectory: async () => { throw new Error("directory sync failed"); },
    })).rejects.toThrow("directory sync failed");
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(next);
    expect((await readdir(dirname(seed.path))).filter((name) => name.includes(".pending-"))).toEqual([]);
  });
});

describe("createLocalReviewStore", () => {
  it("serializes concurrent updates without losing decisions", async () => {
    const { seed } = await fixture();
    seed.validIds = Array.from({ length: 20 }, (_, index) => `phrase-${index}`);
    seed.sampledIds = ["phrase-0"];
    const store = await createLocalReviewStore(seed);
    await Promise.all(seed.validIds.map((id, index) => store.update(async (current) => {
      await Promise.resolve();
      return {
        ...current,
        items: {
          ...current.items,
          [id]: { decision: "pass", note: `${index}`, updatedAt: "2026-08-18T12:00:00.000Z" },
        },
      };
    })));
    expect(Object.keys((await store.read()).items)).toHaveLength(20);
    expect(Object.keys(JSON.parse(await readFile(seed.path, "utf8")).items)).toHaveLength(20);
  });

  it("keeps prior state after failure and remains usable", async () => {
    const { seed } = await fixture();
    let failReplace = true;
    const store = await createLocalReviewStore(seed, {
      atomicReplace: async (temporaryPath, destinationPath) => {
        if (failReplace) {
          failReplace = false;
          throw new Error("replace failed");
        }
        await rename(temporaryPath, destinationPath);
      },
    });
    await expect(store.update((current) => ({
      ...current,
      items: { "phrase-1": { decision: "issue", note: "must not stick", updatedAt: "2026-08-18T12:00:00.000Z" } },
    }))).rejects.toThrow("replace failed");
    expect((await store.read()).items).toEqual({});
    const next = await store.update((current) => ({
      ...current,
      items: { "phrase-1": { decision: "pass", note: "ok", updatedAt: "2026-08-18T12:00:00.000Z" } },
    }));
    expect(next.items["phrase-1"].note).toBe("ok");
  });

  it("returns clones and does not expose mutable in-memory state", async () => {
    const { seed } = await fixture();
    const store = await createLocalReviewStore(seed);
    const read = await store.read();
    read.items["phrase-1"] = { decision: "issue", note: "mutated", updatedAt: "2026-08-18T12:00:00.000Z" };
    read.sampledIds.push("phrase-3");
    expect(await store.read()).toMatchObject({ sampledIds: ["phrase-1", "phrase-2"], items: {} });
  });

  it("makes reads wait for an in-flight update and return its committed state", async () => {
    const { seed } = await fixture();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const store = await createLocalReviewStore(seed);
    const update = store.update(async (current) => {
      await blocked;
      return {
        ...current,
        items: { "phrase-1": { decision: "pass", note: "latest", updatedAt: "2026-08-18T12:00:00.000Z" } },
      };
    });
    let readSettled = false;
    const read = store.read().then((state) => { readSettled = true; return state; });
    await Promise.resolve();
    expect(readSettled).toBe(false);
    release();
    await update;
    expect((await read).items["phrase-1"].note).toBe("latest");
  });

  it("returns the last committed state after an in-flight update fails", async () => {
    const { seed } = await fixture();
    let rejectReplace!: () => void;
    let replaceEntered!: () => void;
    const entered = new Promise<void>((resolve) => { replaceEntered = resolve; });
    const blockedFailure = new Promise<void>((_resolve, reject) => { rejectReplace = () => reject(new Error("replace failed")); });
    const store = await createLocalReviewStore(seed, { atomicReplace: async () => { replaceEntered(); await blockedFailure; } });
    const failedUpdate = store.update((current) => ({
      ...current,
      items: { "phrase-1": { decision: "issue", note: "uncommitted", updatedAt: "2026-08-18T12:00:00.000Z" } },
    }));
    const failedAssertion = expect(failedUpdate).rejects.toThrow("replace failed");
    const read = store.read();
    await entered;
    rejectReplace();
    await failedAssertion;
    expect((await read).items).toEqual({});
  });

  it("rejects identity changes from a mutator", async () => {
    const { seed } = await fixture();
    const store = await createLocalReviewStore(seed);
    await expect(store.update((current) => ({ ...current, candidateSha256: HASH_B }))).rejects.toThrow(/identity/i);
    expect((await store.read()).candidateSha256).toBe(HASH_A);
  });

  it("serializes concurrent updates across stores using equivalent path spellings", async () => {
    const { seed } = await fixture();
    const equivalentPath = process.platform === "win32"
      ? seed.path.toUpperCase()
      : `${dirname(seed.path)}${sep}.${sep}${basename(seed.path)}`;
    const first = await createLocalReviewStore(seed);
    const second = await createLocalReviewStore({ ...seed, path: equivalentPath });

    await Promise.all([
      first.update((current) => ({ ...current, items: { ...current.items, "phrase-1": { decision: "pass", note: "one", updatedAt: "2026-08-18T12:00:00.000Z" } } })),
      second.update((current) => ({ ...current, items: { ...current.items, "phrase-2": { decision: "pass", note: "two", updatedAt: "2026-08-18T12:00:00.000Z" } } })),
    ]);

    expect((await first.read()).items).toMatchObject({ "phrase-1": { note: "one" }, "phrase-2": { note: "two" } });
    expect(JSON.parse(await readFile(seed.path, "utf8")).items).toMatchObject({ "phrase-1": { note: "one" }, "phrase-2": { note: "two" } });
  });

  it("does not lose 20 concurrent updates split across two stores", async () => {
    const { seed } = await fixture();
    seed.validIds = Array.from({ length: 20 }, (_, index) => `phrase-${index}`);
    seed.sampledIds = ["phrase-0"];
    const first = await createLocalReviewStore(seed);
    const second = await createLocalReviewStore(seed);
    await Promise.all(seed.validIds.map((id, index) => (index % 2 ? first : second).update((current) => ({
      ...current,
      items: { ...current.items, [id]: { decision: "pass", note: `${index}`, updatedAt: "2026-08-18T12:00:00.000Z" } },
    }))));
    expect(Object.keys((await first.read()).items)).toHaveLength(20);
    expect(Object.keys(JSON.parse(await readFile(seed.path, "utf8")).items)).toHaveLength(20);
  });

  it("allows another store to update after a shared-queue failure", async () => {
    const { seed } = await fixture();
    const failing = await createLocalReviewStore(seed, { atomicReplace: async () => { throw new Error("replace failed"); } });
    const healthy = await createLocalReviewStore(seed);
    await expect(failing.update((current) => ({ ...current, items: { "phrase-1": { decision: "issue", note: "bad", updatedAt: "2026-08-18T12:00:00.000Z" } } }))).rejects.toThrow("replace failed");
    const saved = await healthy.update((current) => ({ ...current, items: { "phrase-2": { decision: "pass", note: "good", updatedAt: "2026-08-18T12:00:00.000Z" } } }));
    expect(saved.items).toEqual({ "phrase-2": expect.objectContaining({ note: "good" }) });
  });

  it("preserves prior state after bounded Windows retry exhaustion and keeps the queue usable", async () => {
    const { seed } = await fixture();
    await saveReview(seed.path, decided(seed), { validIds: seed.validIds });
    const priorBytes = await readFile(seed.path, "utf8");
    let attempts = 0;
    const store = await createLocalReviewStore(seed, {
      platform: "win32",
      atomicReplace: async (temporaryPath, destinationPath) => {
        attempts += 1;
        if (attempts <= 5) throw transientReplaceError(attempts % 2 ? "EPERM" : "EACCES");
        await rename(temporaryPath, destinationPath);
      },
      retryDelay: async () => undefined,
      syncCommittedDestination: async () => undefined,
    });

    await expect(store.update((current) => ({
      ...current,
      approvedAt: "2026-08-18T12:02:00.000Z",
    }))).rejects.toMatchObject({ code: "EPERM" });
    expect(attempts).toBe(5);
    expect(await readFile(seed.path, "utf8")).toBe(priorBytes);
    expect((await readdir(dirname(seed.path))).filter((name) => name.includes(".pending-"))).toEqual([]);

    const recovered = await store.update((current) => ({
      ...current,
      approvedAt: "2026-08-18T12:03:00.000Z",
    }));
    expect(attempts).toBe(6);
    expect(recovered.approvedAt).toBe("2026-08-18T12:03:00.000Z");
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toEqual(recovered);
  });

  it("reloads disk truth after post-rename sync failure and keeps the shared queue usable", async () => {
    const { seed } = await fixture();
    const uncertain = await createLocalReviewStore(seed, {
      platform: "win32",
      syncCommittedDestination: async () => { throw new Error("committed file sync failed"); },
    });
    const healthy = await createLocalReviewStore(seed);
    await expect(uncertain.update((current) => ({
      ...current,
      items: { ...current.items, "phrase-1": { decision: "pass", note: "committed", updatedAt: "2026-08-18T12:00:00.000Z" } },
    }))).rejects.toThrow("committed file sync failed");

    const recovered = await healthy.update((current) => ({
      ...current,
      items: { ...current.items, "phrase-2": { decision: "pass", note: "next", updatedAt: "2026-08-18T12:00:00.000Z" } },
    }));
    expect(recovered.items).toMatchObject({ "phrase-1": { note: "committed" }, "phrase-2": { note: "next" } });
    expect(JSON.parse(await readFile(seed.path, "utf8")).items).toMatchObject(recovered.items);
  });

  it("canonicalizes missing nested destinations identically through a directory alias", async () => {
    const { directory } = await fixture();
    const alias = await directoryAlias(directory);
    const realTarget = join(directory, "missing", "nested", "review.json");
    const aliasTarget = join(alias, "missing", "nested", "review.json");

    const realCanonical = await canonicalLocalReviewPath(realTarget);
    const aliasCanonical = await canonicalLocalReviewPath(aliasTarget);
    expect(aliasCanonical).toEqual(realCanonical);
    await expect(readdir(join(directory, "missing"))).rejects.toThrow();
  });

  it("preserves mixed-case physical paths while deriving a lowercase Windows queue key", async () => {
    const { directory } = await fixture();
    const mixedTail = join("MissingReviewDir", "MiXeD-Review.JSON");
    const canonical = await canonicalLocalReviewPath(join(directory, mixedTail), "win32");

    expect(canonical.physicalPath.endsWith(mixedTail)).toBe(true);
    expect(canonical.queueKey).toBe(canonical.physicalPath.toLowerCase());
    expect(canonical.physicalPath).not.toBe(canonical.queueKey);
    await expect(readdir(join(directory, "MissingReviewDir"))).rejects.toThrow();
  });

  it("keeps case-distinct physical targets and queue keys on case-sensitive platforms", async () => {
    const { directory } = await fixture();
    const upper = await canonicalLocalReviewPath(join(directory, "Review-A.json"), "linux");
    const lower = await canonicalLocalReviewPath(join(directory, "review-a.json"), "linux");
    expect(upper.physicalPath).not.toBe(lower.physicalPath);
    expect(upper.queueKey).not.toBe(lower.queueKey);
  });

  it("serializes initialization through an alias before any missing review directory is created", async () => {
    const { directory, seed } = await fixture();
    const alias = await directoryAlias(directory);
    const first = await createLocalReviewStore(seed);
    let release!: () => void;
    let mutatorEntered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { mutatorEntered = resolve; });
    const firstUpdate = first.update(async (current) => {
      mutatorEntered();
      await blocked;
      return {
        ...current,
        items: { "phrase-1": { decision: "pass", note: "old identity", updatedAt: "2026-08-18T12:00:00.000Z" } },
      };
    });
    await entered;

    let aliasInitializationSettled = false;
    const aliasSeed = {
      ...seed,
      path: join(alias, ".content-agent", basename(seed.path)),
      candidateSha256: HASH_B,
    };
    let aliasInitializationError: unknown;
    const aliasInitialization = createLocalReviewStore(aliasSeed).then(
      (store) => { aliasInitializationSettled = true; return store; },
      (error: unknown) => { aliasInitializationSettled = true; aliasInitializationError = error; return undefined; },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aliasInitializationSettled).toBe(false);

    release();
    await firstUpdate;
    const second = await aliasInitialization;
    if (!second) throw aliasInitializationError;
    const final = await second.read();
    expect(final).toMatchObject({ candidateSha256: HASH_B, items: {} });
    expect(JSON.parse(await readFile(seed.path, "utf8"))).toMatchObject({ candidateSha256: HASH_B, items: {} });
  });
});
