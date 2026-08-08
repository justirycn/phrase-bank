import { beforeEach, describe, expect, it } from "vitest";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";
import { createNewPhrase } from "../../app/domain/review";

describe("LocalPhraseRepository", () => {
  let repo: LocalPhraseRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    repo = new LocalPhraseRepository(`phrase-bank-${crypto.randomUUID()}`);
    await repo.initialize();
  });

  it("seeds the eight default categories once", async () => {
    expect(await repo.listCategories()).toHaveLength(8);
    expect(await repo.listPhrases()).toHaveLength(40);
    await repo.initialize();
    expect(await repo.listCategories()).toHaveLength(8);
    expect(await repo.listPhrases()).toHaveLength(40);
  });

  it("does not restore a starter phrase deleted after initialization", async () => {
    await repo.deletePhrase("starter-daily-not-sure");
    await repo.initialize();
    expect(await repo.getPhrase("starter-daily-not-sure")).toBeUndefined();
    expect(await repo.listPhrases()).toHaveLength(39);
  });

  it("does not overwrite an existing phrase with a starter id", async () => {
    globalThis.indexedDB = new IDBFactory();
    const customRepo = new LocalPhraseRepository(`phrase-bank-${crypto.randomUUID()}`);
    const custom = { ...createNewPhrase({ english: "My custom version", chinese: "我的版本", categoryId: "daily" }), id: "starter-daily-not-sure", reviewStep: 3, masteryLevel: 3 };
    await customRepo.savePhrase(custom);
    await customRepo.initialize();
    expect(await customRepo.getPhrase(custom.id)).toMatchObject({ english: "My custom version", reviewStep: 3, masteryLevel: 3 });
    expect(await customRepo.listPhrases()).toHaveLength(40);
  });

  it("saves, lists, updates and deletes a phrase", async () => {
    const phrase = createNewPhrase({ english: "I'm ready.", chinese: "我准备好了。", categoryId: "daily" });
    await repo.savePhrase(phrase);
    expect((await repo.listPhrases()).map((item) => item.english)).toContain("I'm ready.");
    await repo.savePhrase({ ...phrase, chinese: "我已经准备好了。" });
    expect((await repo.getPhrase(phrase.id))?.chinese).toBe("我已经准备好了。");
    await repo.deletePhrase(phrase.id);
    expect(await repo.getPhrase(phrase.id)).toBeUndefined();
  });

  it("returns only phrases due by the requested time", async () => {
    const now = new Date("2026-08-07T08:00:00.000Z");
    const due = createNewPhrase({ english: "Due", chinese: "到期", categoryId: "daily" }, now);
    const future = { ...createNewPhrase({ english: "Future", chinese: "未来", categoryId: "daily" }, now), id: "future", nextReviewAt: "2026-08-09T08:00:00.000Z" };
    await repo.savePhrase(due); await repo.savePhrase(future);
    expect((await repo.listDuePhrases(now)).map((item) => item.english)).toEqual(["Due"]);
  });

  it("submits a review atomically", async () => {
    const now = new Date("2026-08-07T08:00:00.000Z");
    const phrase = createNewPhrase({ english: "Review", chinese: "复习", categoryId: "daily" }, now);
    await repo.savePhrase(phrase);
    await repo.submitReview(phrase.id, "good", now);
    expect((await repo.getPhrase(phrase.id))?.reviewStep).toBe(1);
    expect((await repo.exportSnapshot()).reviewLogs).toHaveLength(1);
  });
});
