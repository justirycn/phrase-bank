import { describe, expect, it } from "vitest";
import {
  countNewPhrasesOnShanghaiDay,
  deriveDailyTask,
  shanghaiDayBounds,
} from "../../app/domain/dailyTask";
import type { TrainingEvent } from "../../app/domain/types";

function event(
  id: string,
  phraseId: string,
  occurredAt: string,
  source: TrainingEvent["source"] = "new",
): TrainingEvent {
  return {
    id,
    sessionId: "session",
    phraseId,
    source,
    result: "good",
    usedPronunciationHint: false,
    recorded: false,
    activeSeconds: 1,
    occurredAt,
  };
}

describe("deriveDailyTask", () => {
  it("keeps review work ahead of new-phrase learning", () => {
    expect(deriveDailyTask({
      dueCount: 2,
      activeReview: false,
      newCompletedToday: 10,
      newGoal: 10,
      availableNew: 20,
    })).toEqual({
      stage: "review",
      reviewPending: true,
      newRemaining: 0,
      nextBatchSize: 0,
      inventoryShortage: 0,
      complete: false,
      autonomousUnlocked: false,
    });
  });

  it("resumes an active review even when its original due count is exhausted", () => {
    expect(deriveDailyTask({
      dueCount: 0,
      activeReview: true,
      newCompletedToday: 0,
      newGoal: 10,
      availableNew: 20,
    })).toMatchObject({ stage: "review", reviewPending: true, complete: false });
  });

  it("caps the next learning batch at five and at the remaining goal", () => {
    expect(deriveDailyTask({
      dueCount: 0,
      activeReview: false,
      newCompletedToday: 6,
      newGoal: 10,
      availableNew: 20,
    })).toEqual({
      stage: "learning",
      reviewPending: false,
      newRemaining: 4,
      nextBatchSize: 4,
      inventoryShortage: 0,
      complete: false,
      autonomousUnlocked: false,
    });
  });

  it("unlocks autonomous learning only after the new-phrase goal is complete", () => {
    expect(deriveDailyTask({
      dueCount: 0,
      activeReview: false,
      newCompletedToday: 10,
      newGoal: 10,
      availableNew: 20,
    })).toEqual({
      stage: "complete",
      reviewPending: false,
      newRemaining: 0,
      nextBatchSize: 0,
      inventoryShortage: 0,
      complete: true,
      autonomousUnlocked: true,
    });
  });

  it("keeps a short-inventory task in learning and reports its shortage", () => {
    expect(deriveDailyTask({
      dueCount: 0,
      activeReview: false,
      newCompletedToday: 3,
      newGoal: 10,
      availableNew: 0,
      activeDailyLearning: false,
    })).toEqual({
      stage: "learning",
      reviewPending: false,
      newRemaining: 7,
      nextBatchSize: 0,
      inventoryShortage: 7,
      complete: false,
      autonomousUnlocked: false,
    });
  });

  it("completes immediately after the goal drops below today's progress despite an active daily session", () => {
    expect(deriveDailyTask({
      dueCount: 0,
      activeReview: false,
      newCompletedToday: 8,
      newGoal: 5,
      availableNew: 20,
      activeDailyLearning: true,
    })).toEqual({
      stage: "complete",
      reviewPending: false,
      newRemaining: 0,
      nextBatchSize: 0,
      inventoryShortage: 0,
      complete: true,
      autonomousUnlocked: true,
    });
  });

  it("does not report an inventory shortage until pending review work is complete", () => {
    expect(deriveDailyTask({
      dueCount: 2,
      activeReview: false,
      newCompletedToday: 3,
      newGoal: 10,
      availableNew: 0,
    })).toEqual({
      stage: "review",
      reviewPending: true,
      newRemaining: 7,
      nextBatchSize: 0,
      inventoryShortage: 0,
      complete: false,
      autonomousUnlocked: false,
    });
  });
});

describe("Shanghai new-phrase completion counting", () => {
  it("builds an inclusive/exclusive UTC range for a Shanghai calendar day", () => {
    expect(shanghaiDayBounds("2026-08-10")).toEqual({
      startInclusive: "2026-08-09T16:00:00.000Z",
      endExclusive: "2026-08-10T16:00:00.000Z",
    });
  });

  it("counts only new-source events inside the Shanghai day and deduplicates phrase IDs", () => {
    const events = [
      event("before", "before", "2026-08-09T15:59:59.999Z"),
      event("start", "one", "2026-08-09T16:00:00.000Z"),
      event("duplicate", "one", "2026-08-10T08:00:00.000Z"),
      event("review", "two", "2026-08-10T09:00:00.000Z", "due"),
      event("inside", "three", "2026-08-10T15:59:59.999Z"),
      event("end", "end", "2026-08-10T16:00:00.000Z"),
    ];

    expect(countNewPhrasesOnShanghaiDay(events, "2026-08-10")).toBe(2);
  });

  it("does not infer completions from learned state when there is no new-source event", () => {
    expect(countNewPhrasesOnShanghaiDay([], "2026-08-10")).toBe(0);
  });
});
