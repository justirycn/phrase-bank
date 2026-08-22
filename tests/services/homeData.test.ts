import { describe, expect, it, vi } from "vitest";
import type { PhraseRepository } from "../../app/storage/repository";
import { loadHomeData, loadHomeDataForReviewHandoff, shanghaiHeatmapRange } from "../../app/services/homeData";

function repository(overrides: Partial<PhraseRepository> = {}): PhraseRepository {
  return {
    listPhrases: vi.fn(async () => [{ id: "phrase" }]),
    listCategories: vi.fn(async () => [{ id: "category" }]),
    listDuePhrases: vi.fn(async () => [{ id: "due" }]),
    listTrainingSessions: vi.fn(async () => [{ id: "session" }]),
    listPhraseLearningStates: vi.fn(async () => [{ phraseId: "phrase", stage: "learned", consecutiveGood: 0, masteredDates: [], updatedAt: "2026-08-11T08:00:00.000Z" }]),
    getActiveTrainingSession: vi.fn(async () => ({ id: "active-training" })),
    getActiveLearningSession: vi.fn(async (purpose) => ({ id: `active-${purpose}`, purpose })),
    getAppPreferences: vi.fn(async () => ({ dailyMasteryGoal: 12, dailyNewPhraseGoal: 10 })),
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
  it("stops waiting for a stalled review handoff read", async () => {
    const repo = repository({ listPhrases: vi.fn(() => new Promise(() => undefined)) });

    await expect(loadHomeDataForReviewHandoff(repo, new Date("2026-08-11T08:00:00.000Z"), 10)).resolves.toBeUndefined();
  });

  it("loads bounded home data once per repository method without exporting a snapshot", async () => {
    const repo = repository();
    const now = new Date("2026-08-11T08:00:00.000Z");
    const result = await loadHomeData(repo, now);
    const eventFrom = new Date("2026-05-19T16:00:00.000Z");
    const heatmapFrom = new Date("2026-05-24T16:00:00.000Z");
    const to = new Date("2026-08-11T15:59:59.999Z");

    expect(repo.listPhrases).toHaveBeenCalledTimes(1);
    expect(repo.listCategories).toHaveBeenCalledTimes(1);
    expect(repo.listDuePhrases).toHaveBeenCalledTimes(1);
    expect(repo.listDuePhrases).toHaveBeenCalledWith(now);
    expect(repo.listTrainingSessions).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingSessions).toHaveBeenCalledWith(heatmapFrom, to);
    expect(repo.listPhraseLearningStates).toHaveBeenCalledTimes(1);
    expect(repo.getActiveTrainingSession).toHaveBeenCalledTimes(1);
    expect(repo.getActiveLearningSession).toHaveBeenCalledTimes(2);
    expect(repo.getActiveLearningSession).toHaveBeenNthCalledWith(1, "daily");
    expect(repo.getActiveLearningSession).toHaveBeenNthCalledWith(2, "autonomous");
    expect(repo.getAppPreferences).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingEvents).toHaveBeenCalledTimes(1);
    expect(repo.listTrainingEvents).toHaveBeenCalledWith(eventFrom, to);
    expect(repo.exportSnapshot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      phrases: [{ id: "phrase" }], categories: [{ id: "category" }], duePhrases: [{ id: "due" }],
      trainingSessions: [{ id: "session" }], learningStates: [{ phraseId: "phrase" }],
      activeTrainingSession: { id: "active-training" },
      activeDailyLearningSession: { id: "active-daily", purpose: "daily" },
      activeAutonomousLearningSession: { id: "active-autonomous", purpose: "autonomous" },
      appPreferences: { dailyMasteryGoal: 12, dailyNewPhraseGoal: 10 },
      outcomes: {
        dailyProgress: { correct: 0, mastered: 0, reviewed: 0 },
        streak: { current: 0, lightDaysUsedThisWeek: 0 },
        weeklySummary: { weekStart: "2026-08-10", masteredCount: 0, retentionRate: undefined, forgettableCount: 0 },
      },
      events: [], heatmapError: "",
    });
    expect(result.heatmap).toHaveLength(84);
  });

  it("keeps an exact rolling 84-day event on a midweek home while the Monday heatmap filters it out", async () => {
    const oldEvent = {
      id: "rolling-boundary", sessionId: "session", phraseId: "old-phrase", source: "due" as const,
      result: "again" as const, usedPronunciationHint: false, recorded: false, activeSeconds: 1,
      occurredAt: "2026-05-20T08:00:00.000Z",
    };
    const repo = repository({ listTrainingEvents: vi.fn(async () => [oldEvent]) });

    const result = await loadHomeData(repo, new Date("2026-08-11T08:00:00.000Z"));

    expect(result.events).toEqual([oldEvent]);
    expect(result.heatmap).toHaveLength(84);
    expect(result.heatmap.some(({ date }) => date === "2026-05-20")).toBe(false);
    expect(result.heatmap.reduce((total, day) => total + day.count, 0)).toBe(0);
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
