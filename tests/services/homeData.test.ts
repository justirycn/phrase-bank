import { describe, expect, it, vi } from "vitest";
import type { PhraseRepository } from "../../app/storage/repository";
import { loadHomeData, shanghaiHeatmapRange } from "../../app/services/homeData";

function repository(overrides: Partial<PhraseRepository> = {}): PhraseRepository {
  return {
    listPhrases: vi.fn(async () => [{ id: "phrase" }]),
    listCategories: vi.fn(async () => [{ id: "category" }]),
    listDuePhrases: vi.fn(async () => [{ id: "due" }]),
    listTrainingSessions: vi.fn(async () => [{ id: "session" }]),
    listPhraseLearningStates: vi.fn(async () => [{ phraseId: "phrase" }]),
    getActiveTrainingSession: vi.fn(async () => ({ id: "active-training" })),
    getActiveLearningSession: vi.fn(async () => ({ id: "active-learning" })),
    getAppPreferences: vi.fn(async () => ({ dailyMasteryGoal: 12 })),
    listTrainingEvents: vi.fn(async () => []),
    exportSnapshot: vi.fn(),
    ...overrides,
  } as unknown as PhraseRepository;
}

describe("shanghaiHeatmapRange", () => {
  it("returns the exact Shanghai 12-week heatmap UTC bounds", () => {
    const range = shanghaiHeatmapRange(new Date("2026-08-11T08:00:00.000Z"));
    expect(range.from.toISOString()).toBe("2026-05-24T16:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-08-11T15:59:59.999Z");
  });
});

describe("loadHomeData", () => {
  it("loads bounded home data once per repository method without exporting a snapshot", async () => {
    const repo = repository();
    const now = new Date("2026-08-11T08:00:00.000Z");
    const result = await loadHomeData(repo, now);
    const from = new Date("2026-05-24T16:00:00.000Z");
    const to = new Date("2026-08-11T15:59:59.999Z");

    expect(repo.listPhrases).toHaveBeenCalledTimes(1);
    expect(repo.listCategories).toHaveBeenCalledTimes(1);
    expect(repo.listDuePhrases).toHaveBeenCalledTimes(1);
    expect(repo.listDuePhrases).toHaveBeenCalledWith(now);
    expect(repo.listTrainingSessions).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingSessions).toHaveBeenCalledWith(from, to);
    expect(repo.listPhraseLearningStates).toHaveBeenCalledTimes(1);
    expect(repo.getActiveTrainingSession).toHaveBeenCalledTimes(1);
    expect(repo.getActiveLearningSession).toHaveBeenCalledTimes(1);
    expect(repo.getAppPreferences).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingEvents).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingEvents).toHaveBeenCalledWith(from, to);
    expect(repo.exportSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      phrases: [{ id: "phrase" }], categories: [{ id: "category" }], duePhrases: [{ id: "due" }],
      trainingSessions: [{ id: "session" }], learningStates: [{ phraseId: "phrase" }],
      activeTrainingSession: { id: "active-training" }, activeLearningSession: { id: "active-learning" },
      appPreferences: { dailyMasteryGoal: 12 },
      events: [], heatmapError: "",
    });
    expect(result.heatmap).toHaveLength(84);
  });

  it("isolates event failures while preserving successful core data", async () => {
    const repo = repository({ listTrainingEvents: vi.fn(async () => { throw new Error("events failed"); }) });
    const result = await loadHomeData(repo, new Date("2026-08-11T08:00:00.000Z"));

    expect(result.phrases).toEqual([{ id: "phrase" }]);
    expect(result.trainingSessions).toEqual([{ id: "session" }]);
    expect(result.events).toEqual([]);
    expect(result.heatmap).toEqual([]);
    expect(result.heatmapError).toBe("学习足迹暂时无法加载");
  });

  it("rejects when a core read fails", async () => {
    const repo = repository({ listCategories: vi.fn(async () => { throw new Error("core failed"); }) });
    await expect(loadHomeData(repo)).rejects.toThrow("core failed");
  });

  it("handles an early event rejection while core reads are still pending", async () => {
    let releaseCore!: () => void;
    const coreGate = new Promise<void>((resolve) => { releaseCore = resolve; });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const repo = repository({
        listPhrases: vi.fn(async () => { await coreGate; return []; }),
        listTrainingEvents: vi.fn(async () => { throw new Error("early event failure"); }),
      });
      const loading = loadHomeData(repo, new Date("2026-08-11T08:00:00.000Z"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
      releaseCore();
      await expect(loading).resolves.toMatchObject({ events: [], heatmapError: "学习足迹暂时无法加载" });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      releaseCore?.();
    }
  });
});
