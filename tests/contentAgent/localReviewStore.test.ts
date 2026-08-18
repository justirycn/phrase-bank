import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewState } from "../../scripts/content-agent/localReview";
import {
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

function decided(seed: LocalReviewSeed): ReviewState {
  return {
    format: "phrase-bank-local-review",
    version: seed.version,
    candidateSha256: seed.candidateSha256,
    sampleSeed: seed.sampleSeed,
    sampledIds: [...seed.sampledIds],
    items: {
      "phrase-1": { decision: "pass", note: "checked", updatedAt: "2026-08-18T12:00:00.000Z" },
    },
    approvedAt: "2026-08-18T12:01:00.000Z",
  };
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
    state.items = { "phrase-3": state.items["phrase-1"] };
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
    [{ ...({} as LocalReviewSeed), path: "x", version: "bad version", candidateSha256: HASH_A, sampleSeed: "s", sampledIds: ["a"], validIds: ["a"] }, /version/i],
    [{ ...({} as LocalReviewSeed), path: "x", version: "v1", candidateSha256: "abc", sampleSeed: "s", sampledIds: ["a"], validIds: ["a"] }, /hash/i],
    [{ ...({} as LocalReviewSeed), path: "x", version: "v1", candidateSha256: HASH_A, sampleSeed: "s", sampledIds: ["a", "a"], validIds: ["a"] }, /sample/i],
    [{ ...({} as LocalReviewSeed), path: "x", version: "v1", candidateSha256: HASH_A, sampleSeed: "s", sampledIds: ["a"], validIds: ["b"] }, /sample/i],
    [{ ...({} as LocalReviewSeed), path: "x", version: "v1", candidateSha256: HASH_A, sampleSeed: "s", sampledIds: ["a"], validIds: ["a", "a"] }, /valid/i],
  ])("rejects an invalid seed", async (seed, message) => {
    await expect(loadOrCreateReview(seed)).rejects.toThrow(message);
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
      ? { validIds: seed.validIds, writeTemp: async (path: string) => { await writeFile(path, "partial", { flag: "wx" }); throw new Error("write failed"); } }
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

  it("rejects identity changes from a mutator", async () => {
    const { seed } = await fixture();
    const store = await createLocalReviewStore(seed);
    await expect(store.update((current) => ({ ...current, candidateSha256: HASH_B }))).rejects.toThrow(/identity/i);
    expect((await store.read()).candidateSha256).toBe(HASH_A);
  });
});
