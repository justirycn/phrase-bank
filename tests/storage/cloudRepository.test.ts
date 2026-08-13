import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { CloudPhraseRepository } from "../../app/storage/cloudRepository";
import { createNewPhrase } from "../../app/domain/review";

describe("CloudPhraseRepository", () => {
  it("invokes the browser fetch function with the global context", async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ snapshot: null }));
    }) as unknown as typeof fetch;

    const repo = new CloudPhraseRepository(fetcher);
    await expect(repo.initialize()).resolves.toBeUndefined();
  });

  it("starts from cloud data and uploads changes", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({ ok: true })
      : Response.json({ snapshot: null }));
    const repo = new CloudPhraseRepository(fetcher);
    await repo.initialize();
    const categories = await repo.listCategories();
    await repo.savePhrase({ id: "mine", english: "Hello", chinese: "你好", categoryId: categories[0].id, reviewStep: 0, masteryLevel: 0, nextReviewAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origin: "personal", kind: "standalone" });
    expect(fetcher).toHaveBeenCalledWith("/api/repository", expect.objectContaining({ method: "PUT" }));
  });

  it("uploads daily mastery preference changes", async () => {
    const uploads: unknown[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        uploads.push(JSON.parse(String(init.body)));
        return Response.json({ ok: true });
      }
      return Response.json({ snapshot: null });
    });
    const repo = new CloudPhraseRepository(fetcher);
    await repo.initialize();
    await repo.saveAppPreferences({ dailyMasteryGoal: 12 });
    expect(uploads.at(-1)).toMatchObject({ snapshot: { version: 5, appPreferences: { dailyMasteryGoal: 12 } } });
  });

  it("normalizes already-v5 mastery while loading a cloud snapshot", async () => {
    const now = "2026-08-10T08:00:00.000Z";
    const phrase = { ...createNewPhrase({ english: "Cloud state", chinese: "云端状态", categoryId: "daily" }, new Date(now)), id: "cloud-state" };
    const snapshot = {
      format: "personal-phrase-bank" as const, version: 5 as const, exportedAt: now,
      categories: [{ id: "daily", name: "日常", isDefault: true, createdAt: now, updatedAt: now }],
      phrases: [phrase], reviewLogs: [], trainingEvents: [], trainingSessions: [], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 },
      phraseLearningStates: [{
        phraseId: phrase.id, stage: "mastered" as const, firstSeenAt: now, firstTestedAt: now, firstResult: "good" as const,
        consecutiveGood: 3, masteredDates: ["2026-08-07"], updatedAt: now,
      }],
    };
    const repo = new CloudPhraseRepository(async (_input, init) => init?.method === "PUT"
      ? Response.json({ ok: true })
      : Response.json({ snapshot }));

    await repo.initialize();

    expect(await repo.getPhraseLearningState(phrase.id)).toMatchObject({ stage: "learned", consecutiveGood: 1 });
  });

  it("retries a failed cloud upload after local review persistence without double-applying", async () => {
    let failNextUpload = false;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "PUT") return Response.json({ snapshot: null });
      if (failNextUpload) { failNextUpload = false; return Response.json({}, { status: 503 }); }
      return Response.json({ ok: true });
    });
    const repo = new CloudPhraseRepository(fetcher);
    await repo.initialize();
    const now = new Date("2026-08-10T08:00:00.000Z");
    const phrase = { ...createNewPhrase({ english: "Cloud retry", chinese: "云端重试", categoryId: "daily" }, now), id: "cloud-retry" };
    await repo.savePhrase(phrase);
    await repo.savePhraseLearningState({
      phraseId: phrase.id, stage: "learned", firstSeenAt: now.toISOString(), firstTestedAt: now.toISOString(),
      firstResult: "good", consecutiveGood: 0, masteredDates: [], updatedAt: now.toISOString(),
    });

    failNextUpload = true;
    await expect(repo.submitReview(phrase.id, "good", now, "cloud-review-operation")).rejects.toThrow("云端数据保存失败");
    await repo.submitReview(phrase.id, "good", new Date("2026-08-10T08:01:00.000Z"), "cloud-review-operation");

    const snapshot = await repo.exportSnapshot();
    expect(snapshot.reviewLogs.filter(({ phraseId }) => phraseId === phrase.id)).toHaveLength(1);
    expect(snapshot.reviewLogs.find(({ phraseId }) => phraseId === phrase.id)?.id).toBe("cloud-review-operation");
    expect(snapshot.phrases.find(({ id }) => id === phrase.id)).toMatchObject({ reviewStep: 1, masteryLevel: 1 });
  });

  it("raises an authentication error on 401", async () => {
    const repo = new CloudPhraseRepository(async () => Response.json({}, { status: 401 }));
    await expect(repo.initialize()).rejects.toMatchObject({ name: "AuthenticationError" });
  });
});
