import { describe, expect, it } from "vitest";
import {
  applyLearningResult,
  effectiveMasteryDates,
  firstMasteryAchievedDate,
  masteryAchievedDate,
  nextExampleToUnlock,
} from "../../app/domain/learningProgress";
import type { Phrase, PhraseLearningState } from "../../app/domain/types";

const state = (overrides: Partial<PhraseLearningState> = {}): PhraseLearningState => ({
  phraseId: "core",
  stage: "learned",
  consecutiveGood: 0,
  masteredDates: [],
  updatedAt: "2026-08-09T00:00:00.000Z",
  ...overrides,
});

const phrase = (id: string, kind: "core" | "example", order?: number): Phrase => ({
  id, english: id, chinese: id, categoryId: "daily", origin: "system", kind,
  parentPhraseId: kind === "example" ? "core" : undefined, unlockOrder: order,
  reviewStep: 0, masteryLevel: 0, nextReviewAt: "2026-08-09T00:00:00.000Z", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z",
});

describe("learning progress", () => {
  it("counts good results once per Asia/Shanghai date", () => {
    const first = applyLearningResult(state(), "good", new Date("2026-08-09T00:00:00.000Z"));
    const sameDay = applyLearningResult(first, "good", new Date("2026-08-09T15:59:59.000Z"));
    const nextDay = applyLearningResult(sameDay, "good", new Date("2026-08-09T16:00:00.000Z"));
    expect(first).toMatchObject({ masteredDates: ["2026-08-09"], stage: "learned", consecutiveGood: 1 });
    expect(sameDay).toMatchObject({ masteredDates: ["2026-08-09"], stage: "learned", consecutiveGood: 1 });
    expect(nextDay).toMatchObject({ masteredDates: ["2026-08-09", "2026-08-10"], stage: "learned", consecutiveGood: 2 });
  });

  it("becomes mastered only after good results on three distinct dates", () => {
    const result = applyLearningResult(state({
      masteredDates: ["2026-08-09", "2026-08-10"],
      consecutiveGood: 2,
    }), "good", new Date("2026-08-11T04:00:00.000Z"));

    expect(result).toMatchObject({
      stage: "mastered",
      consecutiveGood: 3,
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
    });
  });

  it.each(["again", "hard"] as const)("%s resets mastery without deleting its history", (reviewResult) => {
    const now = new Date("2026-08-11T04:05:06.000Z");
    const result = applyLearningResult(state({
      stage: "mastered",
      consecutiveGood: 4,
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
    }), reviewResult, now);

    expect(result).toMatchObject({
      stage: "learned",
      consecutiveGood: 0,
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
      masteryResetAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });

  it("requires three new dates after a reset before remastering", () => {
    const reset = state({
      stage: "learned",
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
      masteryResetAt: "2026-08-11T04:05:06.000Z",
    });
    const resetDay = applyLearningResult(reset, "good", new Date("2026-08-11T10:00:00.000Z"));
    const dayOne = applyLearningResult(resetDay, "good", new Date("2026-08-12T04:00:00.000Z"));
    const dayTwo = applyLearningResult(dayOne, "good", new Date("2026-08-13T04:00:00.000Z"));
    const dayThree = applyLearningResult(dayTwo, "good", new Date("2026-08-14T04:00:00.000Z"));

    expect(resetDay.stage).toBe("learned");
    expect(dayTwo.stage).toBe("learned");
    expect(effectiveMasteryDates(dayTwo)).toEqual(["2026-08-12", "2026-08-13"]);
    expect(dayThree.stage).toBe("mastered");
    expect(masteryAchievedDate(dayThree)).toBe("2026-08-14");
    expect(firstMasteryAchievedDate(dayThree)).toBe("2026-08-11");
  });

  it("preserves partial distinct-day progress across a failure before first mastery", () => {
    const partial = state({ masteredDates: ["2026-08-09", "2026-08-10"], consecutiveGood: 2 });
    const failed = applyLearningResult(partial, "hard", new Date("2026-08-11T04:00:00.000Z"));
    const mastered = applyLearningResult(failed, "good", new Date("2026-08-12T04:00:00.000Z"));

    expect(failed).toMatchObject({
      stage: "learned", consecutiveGood: 2, masteredDates: ["2026-08-09", "2026-08-10"],
    });
    expect(failed.masteryResetAt).toBeUndefined();
    expect(mastered).toMatchObject({
      stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-09", "2026-08-10", "2026-08-12"],
    });
  });

  it("ignores invalid and duplicate legacy mastery dates", () => {
    const legacy = state({
      masteredDates: ["2026-08-12", "not-a-date", "2026-02-30", "2026-08-10", "2026-08-12", "2026-08-11"],
    });

    expect(effectiveMasteryDates(legacy)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(masteryAchievedDate(legacy)).toBe("2026-08-12");
    expect(firstMasteryAchievedDate(legacy)).toBe("2026-08-12");
  });

  it("normalizes legacy mastery dates when recording another good result", () => {
    const result = applyLearningResult(state({
      masteredDates: ["2026-08-10", "invalid", "2026-08-10"],
    }), "good", new Date("2026-08-11T04:00:00.000Z"));

    expect(result).toMatchObject({
      masteredDates: ["2026-08-10", "2026-08-11"],
      consecutiveGood: 2,
    });
  });

  it("does not report an achieved date with fewer than three effective dates", () => {
    expect(masteryAchievedDate(state({ masteredDates: ["2026-08-09", "2026-08-10"] }))).toBeUndefined();
  });

  it("unlocks only the next sequential example after true mastery", () => {
    const core = phrase("core", "core");
    const one = phrase("one", "example", 1);
    const two = phrase("two", "example", 2);
    const twoDates = [state({ masteredDates: ["2026-08-09", "2026-08-10"] })];
    const threeDates = [state({ masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"] })];

    expect(nextExampleToUnlock(core, [one, two], twoDates)).toBeUndefined();
    expect(nextExampleToUnlock(core, [one, two], threeDates)?.id).toBe("one");
    expect(nextExampleToUnlock(one, [one, two], [state({
      phraseId: "one",
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
      unlockedAt: "2026-08-08T00:00:00.000Z",
    })])?.id).toBe("two");
  });

  it("does not unlock from three raw dates invalidated by a reset", () => {
    const core = phrase("core", "core");
    const one = phrase("one", "example", 1);
    const resetState = state({
      stage: "mastered",
      masteredDates: ["2026-08-09", "2026-08-10", "2026-08-11"],
      masteryResetAt: "2026-08-11T04:05:06.000Z",
    });

    expect(nextExampleToUnlock(core, [one], [resetState])).toBeUndefined();
  });
});
