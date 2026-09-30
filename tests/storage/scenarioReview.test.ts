import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";
import { CloudPhraseRepository } from "../../app/storage/cloudRepository";
import { createNewPhrase } from "../../app/domain/review";

describe("explicit scenario expression review", () => {
  let repo: LocalPhraseRepository;
  const input = { english: "Yes, it's my first time here.", chinese: "是的，我第一次来。", sourceNote: "场景练习" };
  const now = new Date("2026-09-29T00:00:00Z");
  beforeEach(async () => { globalThis.indexedDB = new IDBFactory(); repo = new LocalPhraseRepository(`scenario-${crypto.randomUUID()}`); await repo.initialize(); });
  it("creates one personal review item without a grade, first-test credit or mastery", async () => {
    await repo.addScenarioReview(input, now); await repo.addScenarioReview({ ...input, english: "YES, IT'S MY FIRST TIME HERE!" }, now);
    const phrases = (await repo.listPhrases()).filter((p) => p.sourceNote === input.sourceNote);
    expect(phrases).toHaveLength(1); expect(phrases[0]).toMatchObject({ origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: now.toISOString() });
    const state = await repo.getPhraseLearningState(phrases[0].id); expect(state).toMatchObject({ stage: "learned", consecutiveGood: 0, masteredDates: [] }); expect(state?.firstTestedAt).toBeUndefined();
    expect(await repo.listTrainingEvents()).toHaveLength(0); expect((await repo.exportSnapshot()).reviewLogs).toHaveLength(0);
  });
  it("requeues an existing expression without overwriting content or mastery", async () => {
    const p = { ...createNewPhrase({ ...input, categoryId: "daily" }, now), masteryLevel: 3, reviewStep: 3, nextReviewAt: "2026-10-20T00:00:00Z" };
    await repo.savePhrase(p); await repo.savePhraseLearningState({ phraseId: p.id, stage: "learned", consecutiveGood: 2, masteredDates: ["2026-09-20", "2026-09-21"], updatedAt: now.toISOString() });
    const state = await repo.getPhraseLearningState(p.id);
    await repo.addScenarioReview({ ...input, chinese: "不应覆盖原文" }, now);
    expect(await repo.getPhrase(p.id)).toMatchObject({ chinese: input.chinese, masteryLevel: 3, reviewStep: 3, nextReviewAt: now.toISOString() }); expect(await repo.getPhraseLearningState(p.id)).toEqual(state);
  });
  it("does not unlock a locked system example", async () => {
    const p = { ...createNewPhrase({ ...input, categoryId: "daily" }, now), origin: "system" as const, kind: "example" as const, parentPhraseId: "parent" }; await repo.savePhrase(p);
    await repo.savePhraseLearningState({ phraseId: p.id, stage: "unseen", consecutiveGood: 0, masteredDates: [], updatedAt: now.toISOString() }); await repo.addScenarioReview(input, now);
    expect((await repo.getPhraseLearningState(p.id))?.stage).toBe("unseen"); expect((await repo.listPhrases()).filter((item) => item.english === input.english)).toHaveLength(2);
  });
  it("rolls back a failed cloud write and allows a safe retry", async () => {
    let fail = false;
    const cloud = new CloudPhraseRepository(async (_input, init) => init?.method === "PUT" ? Response.json({}, { status: fail ? 503 : 200 }) : Response.json({ snapshot: null }));
    await cloud.initialize(); const before = await cloud.listPhrases(); fail = true;
    await expect(cloud.addScenarioReview(input, now)).rejects.toThrow(); expect(await cloud.listPhrases()).toEqual(before);
    fail = false; await cloud.addScenarioReview(input, now); expect((await cloud.listPhrases()).filter((p) => p.english === input.english)).toHaveLength(1);
  });
  it("deduplicates the same expression after another device wins a cloud revision", async () => {
    const initial = await repo.exportSnapshot(); await repo.addScenarioReview(input, now);
    const other = createNewPhrase({ english: "Keep the other device's sentence.", chinese: "保留另一台设备的句子", categoryId: "daily" }, now); await repo.savePhrase(other);
    const newer = await repo.exportSnapshot(); let conflicted = false; let puts = 0;
    const cloud = new CloudPhraseRepository(async (_url, init) => {
      if (init?.method === "PUT") { puts += 1; if (!conflicted) { conflicted = true; return Response.json({}, { status: 409 }); } return Response.json({ revision: 2 }); }
      return Response.json({ snapshot: conflicted ? newer : initial, revision: conflicted ? 1 : 0 });
    });
    await cloud.initialize(); await cloud.addScenarioReview(input, now);
    expect(puts).toBe(2); expect((await cloud.listPhrases()).filter((p) => p.english === input.english)).toHaveLength(1); expect(await cloud.getPhrase(other.id)).toEqual(other);
  });
});
