import { describe, expect, it } from "vitest";
import { applyLearningResult, nextExampleToUnlock } from "../../app/domain/learningProgress";
import type { Phrase, PhraseLearningState } from "../../app/domain/types";

const state = (): PhraseLearningState => ({ phraseId: "core", masteredDates: [], updatedAt: "2026-08-09T00:00:00.000Z" });
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
    expect(first.masteredDates).toEqual(["2026-08-09"]);
    expect(sameDay.masteredDates).toEqual(["2026-08-09"]);
    expect(nextDay.masteredDates).toEqual(["2026-08-09", "2026-08-10"]);
  });

  it("does not count again or hard as a mastery date", () => {
    expect(applyLearningResult(state(), "again", new Date()).masteredDates).toEqual([]);
    expect(applyLearningResult(state(), "hard", new Date()).masteredDates).toEqual([]);
  });

  it("unlocks only the next sequential example after two mastery dates", () => {
    const core = phrase("core", "core");
    const one = phrase("one", "example", 1);
    const two = phrase("two", "example", 2);
    const mastered = [{ ...state(), masteredDates: ["2026-08-09", "2026-08-10"] }];
    expect(nextExampleToUnlock(core, [one, two], mastered)?.id).toBe("one");
    expect(nextExampleToUnlock(one, [one, two], [{ phraseId: "one", masteredDates: ["2026-08-09", "2026-08-10"], unlockedAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }])?.id).toBe("two");
  });
});
