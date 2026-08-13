import { describe, expect, it } from "vitest";
import {
  calculateStreak,
  summarizeDailySentenceProgress,
  summarizeDailyTraining,
  summarizeWeek,
} from "../../app/domain/trainingStats";
import type {
  DailyTrainingSummary,
  PhraseLearningState,
  ReviewResult,
  TrainingEvent,
  TrainingSessionRecord,
} from "../../app/domain/types";

function state(phraseId: string, overrides: Partial<PhraseLearningState> = {}): PhraseLearningState {
  return {
    phraseId,
    stage: "learned",
    consecutiveGood: 0,
    masteredDates: [],
    updatedAt: "2026-08-09T08:00:00.000Z",
    ...overrides,
  };
}

function event(
  id: string,
  phraseId: string,
  result: ReviewResult,
  occurredAt: string,
  activeSeconds = 0,
  recorded = false,
): TrainingEvent {
  return {
    id,
    sessionId: `session-${id}`,
    phraseId,
    source: "due",
    result,
    usedPronunciationHint: false,
    recorded,
    activeSeconds,
    occurredAt,
  };
}

function session(id: string, completedAt?: string): TrainingSessionRecord {
  return {
    id,
    mode: "standard",
    startedAt: "2026-08-09T00:00:00.000Z",
    updatedAt: completedAt ?? "2026-08-09T00:00:00.000Z",
    completedAt,
    phraseIds: ["phrase-1"],
    currentIndex: 1,
    activeSeconds: 9999,
  };
}

function day(date: string, activeSeconds: number): DailyTrainingSummary {
  return {
    date,
    activeSeconds,
    completedGroups: 0,
    spokenCount: 0,
    masteredCount: 0,
    promotedCount: 0,
    lightDayUsed: activeSeconds >= 300 && activeSeconds < 1200,
  };
}

describe("summarizeDailyTraining", () => {
  it("sums event activity and reports daily completion, speech, and mastery", () => {
    const result = summarizeDailyTraining("2026-08-09", [
      event("one", "phrase-1", "good", "2026-08-09T01:00:00.000Z", 600, true),
      event("two", "phrase-2", "hard", "2026-08-09T02:00:00.000Z", 620),
    ], [
      session("complete", "2026-08-09T03:00:00.000Z"),
      session("incomplete"),
    ]);

    expect(result).toEqual({
      date: "2026-08-09",
      activeSeconds: 1220,
      completedGroups: 1,
      spokenCount: 1,
      masteredCount: 1,
      promotedCount: 0,
      lightDayUsed: false,
      streakQualified: true,
      fullGoalReached: false,
    });
  });

  it("reaches the full goal at exactly 1800 active seconds", () => {
    const result = summarizeDailyTraining("2026-08-09", [
      event("goal", "phrase-1", "hard", "2026-08-09T01:00:00.000Z", 1800),
    ], []);

    expect(result.fullGoalReached).toBe(true);
  });

  it("groups timestamps by the Asia/Shanghai calendar date", () => {
    const result = summarizeDailyTraining("2026-08-09", [
      event("boundary", "phrase-1", "hard", "2026-08-08T16:30:00.000Z", 301),
    ], [session("boundary", "2026-08-08T16:30:00.000Z")]);

    expect(result.activeSeconds).toBe(301);
    expect(result.completedGroups).toBe(1);
    expect(result.lightDayUsed).toBe(true);
  });

  it("promotes only when the immediately preceding phrase event was hard or again", () => {
    const result = summarizeDailyTraining("2026-08-09", [
      event("prior-day", "promoted", "hard", "2026-08-08T15:00:00.000Z"),
      event("promotion", "promoted", "good", "2026-08-09T01:00:00.000Z"),
      event("first-good", "not-promoted", "good", "2026-08-09T02:00:00.000Z"),
      event("second-good", "not-promoted", "good", "2026-08-09T03:00:00.000Z"),
    ], []);

    expect(result.masteredCount).toBe(3);
    expect(result.promotedCount).toBe(1);
  });
});

describe("summarizeDailySentenceProgress", () => {
  it("separates third-day mastery from earlier effective good-day consolidation", () => {
    const result = summarizeDailySentenceProgress("2026-08-09", [
      event("third-day", "phrase-1", "good", "2026-08-08T16:01:00.000Z"),
      event("third-day-repeat", "phrase-1", "good", "2026-08-09T03:00:00.000Z"),
      event("second-day", "phrase-2", "good", "2026-08-09T04:00:00.000Z"),
      { ...event("first-new", "phrase-3", "good", "2026-08-09T05:00:00.000Z"), source: "new" },
      event("hard", "phrase-4", "hard", "2026-08-09T06:00:00.000Z"),
      event("good-before-reset", "phrase-5", "good", "2026-08-09T07:00:00.000Z"),
      event("reset", "phrase-5", "again", "2026-08-09T08:00:00.000Z"),
      event("already-mastered-good", "phrase-6", "good", "2026-08-09T09:00:00.000Z"),
      event("outside", "phrase-4", "good", "2026-08-09T16:00:00.000Z"),
    ], [
      state("phrase-1", { stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-07", "2026-08-08", "2026-08-09"] }),
      state("phrase-2", { consecutiveGood: 2, masteredDates: ["2026-08-08", "2026-08-09"] }),
      state("phrase-3", { consecutiveGood: 1, masteredDates: ["2026-08-09"] }),
      state("phrase-4"),
      state("phrase-5", { masteredDates: ["2026-08-09"], masteryResetAt: "2026-08-09T08:00:00.000Z" }),
      state("phrase-6", { stage: "mastered", consecutiveGood: 4, masteredDates: ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-09"] }),
    ]);

    expect(result).toEqual({ mastered: 1, consolidated: 3, reviewed: 5 });
  });

  it("returns zero for an invalid day", () => {
    expect(summarizeDailySentenceProgress("invalid", [], [])).toEqual({ mastered: 0, consolidated: 0, reviewed: 0 });
  });

  it("does not count effective remastery as a new first mastery or consolidation", () => {
    const remastered = state("remastered", {
      stage: "mastered", consecutiveGood: 3,
      masteredDates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-10", "2026-08-11", "2026-08-12"],
      masteryResetAt: "2026-08-09T08:00:00.000Z",
    });

    expect(summarizeDailySentenceProgress("2026-08-12", [
      event("remastery-good", "remastered", "good", "2026-08-12T08:00:00.000Z"),
    ], [remastered])).toEqual({ mastered: 0, consolidated: 0, reviewed: 1 });
  });
});

describe("calculateStreak", () => {
  it("allows one five-minute light day in each ISO week across a multi-week streak", () => {
    const days = [
      day("2026-08-10", 300),
      day("2026-08-09", 1200),
      day("2026-08-08", 300),
      day("2026-08-07", 1200),
    ];

    expect(calculateStreak(days, "2026-08-10")).toEqual({
      current: 4,
      lightDaysUsedThisWeek: 1,
    });
  });

  it("stops at a second light day in the same ISO week", () => {
    expect(calculateStreak([
      day("2026-08-09", 300),
      day("2026-08-08", 1199),
      day("2026-08-07", 1200),
    ], "2026-08-09")).toEqual({ current: 1, lightDaysUsedThisWeek: 1 });
  });

  it("stops for a missing or sub-five-minute day and ignores future summaries", () => {
    expect(calculateStreak([
      day("2026-08-11", 1200),
      day("2026-08-10", 1200),
      day("2026-08-09", 299),
      day("2026-08-08", 1200),
    ], "2026-08-10")).toEqual({ current: 1, lightDaysUsedThisWeek: 0 });
    expect(calculateStreak([day("2026-08-10", 1200)], "2026-08-11").current).toBe(0);
  });

  it("combines duplicate summaries without double-counting calendar days", () => {
    expect(calculateStreak([
      day("2026-08-09", 600),
      day("2026-08-09", 600),
      day("2026-08-08", 1200),
    ], "2026-08-09")).toEqual({ current: 2, lightDaysUsedThisWeek: 0 });
  });

  it("reports a current-week light day even when a later gap broke the streak", () => {
    expect(calculateStreak([
      day("2026-08-12", 1200),
      day("2026-08-10", 300),
    ], "2026-08-12")).toEqual({ current: 1, lightDaysUsedThisWeek: 1 });
  });
});

describe("summarizeWeek", () => {
  it("uses persisted mastery transitions and each phrase's latest weekly review for retention", () => {
    const events = [
      event("before", "promoted", "again", "2026-08-02T15:59:59.000Z", 100, true),
      { ...event("start", "promoted", "good", "2026-08-02T16:00:00.000Z", 200, true), source: "new" },
      event("alpha-first", "alpha", "again", "2026-08-04T00:00:00.000Z", 300),
      event("alpha-latest", "alpha", "good", "2026-08-05T00:00:00.000Z", 400),
      event("beta", "beta", "hard", "2026-08-07T00:00:00.000Z", 600),
      event("charlie", "charlie", "good", "2026-08-08T00:00:00.000Z", 700),
      event("end", "omega", "good", "2026-08-09T15:59:59.000Z", 800),
      event("after", "outside", "again", "2026-08-09T16:00:00.000Z", 900),
    ];
    const sessions = [
      session("start", "2026-08-02T16:00:00.000Z"),
      session("end", "2026-08-09T15:59:59.000Z"),
      session("after", "2026-08-09T16:00:00.000Z"),
    ];

    const states = [
      state("promoted", { stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-01", "2026-08-02", "2026-08-03"] }),
      state("omega", { consecutiveGood: 2, masteredDates: ["2026-08-08", "2026-08-09"] }),
    ];

    expect(summarizeWeek(events, sessions, states, "2026-08-03", "2026-08-09")).toMatchObject({
      weekStart: "2026-08-03",
      activeSeconds: 3000,
      completedGroups: 2,
      spokenCount: 1,
      masteredCount: 1,
      promotedCount: 2,
      retentionRate: 75,
    });
  });

  it("marks recent again or consecutive hard phrases forgettable unless currently stably mastered", () => {
    const events = [
      event("again", "again-phrase", "again", "2026-08-03T08:00:00.000Z"),
      event("hard-one", "double-hard", "hard", "2026-08-04T08:00:00.000Z"),
      event("hard-two", "double-hard", "hard", "2026-08-05T08:00:00.000Z"),
      event("hard-separated-one", "separated", "hard", "2026-08-04T08:00:00.000Z"),
      event("hard-separated-good", "separated", "good", "2026-08-05T08:00:00.000Z"),
      event("hard-separated-two", "separated", "hard", "2026-08-06T08:00:00.000Z"),
      event("stable-failure-before-mastery", "stable", "again", "2026-08-01T08:00:00.000Z"),
      event("too-old", "old", "again", "2026-05-17T08:00:00.000Z"),
    ];
    const states = [
      state("again-phrase"), state("double-hard"), state("separated"), state("old"),
      state("stable", { stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-03", "2026-08-04", "2026-08-05"] }),
    ];

    expect(summarizeWeek(events, [], states, "2026-08-03", "2026-08-09")).toMatchObject({
      forgettableCount: 2,
      weakPhraseIds: ["double-hard", "again-phrase"],
    });
  });

  it("evaluates mastery and resets as of the requested date, ignoring future state changes", () => {
    const events = [
      event("future-master-failure", "future-master", "again", "2026-08-08T08:00:00.000Z"),
      event("pre-mastery-failure", "future-reset", "again", "2026-08-05T09:00:00.000Z"),
      event("future-reset", "future-reset", "again", "2026-08-10T08:00:00.000Z"),
    ];
    const states = [
      state("future-master", { stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-08", "2026-08-09", "2026-08-10"], updatedAt: "2026-08-10T08:00:00.000Z" }),
      state("future-reset", { stage: "learned", consecutiveGood: 0, masteredDates: ["2026-08-06", "2026-08-07", "2026-08-08"], masteryResetAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z" }),
    ];

    expect(summarizeWeek(events, [], states, "2026-08-03", "2026-08-09")).toMatchObject({
      masteredCount: 1,
      forgettableCount: 1,
      weakPhraseIds: ["future-master"],
    });
  });

  it("includes the first day of the exact twelve-week window", () => {
    expect(summarizeWeek([
      event("window-start", "boundary", "again", "2026-05-18T08:00:00.000Z"),
      event("before-window", "outside", "again", "2026-05-17T08:00:00.000Z"),
    ], [], [state("boundary"), state("outside")], "2026-08-03", "2026-08-09")).toMatchObject({
      forgettableCount: 1,
      weakPhraseIds: ["boundary"],
    });
  });

  it("leaves retention undefined when the week has no non-new result", () => {
    expect(summarizeWeek([
      { ...event("new", "new-only", "good", "2026-08-04T08:00:00.000Z"), source: "new" },
    ], [], [state("new-only", { masteredDates: ["2026-08-04"] })], "2026-08-03", "2026-08-09").retentionRate).toBeUndefined();
  });

  it("counts only historical first mastery transitions, not effective remastery", () => {
    const remastered = state("remastered", {
      stage: "mastered", consecutiveGood: 3,
      masteredDates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-10", "2026-08-11", "2026-08-12"],
      masteryResetAt: "2026-08-09T08:00:00.000Z",
    });

    expect(summarizeWeek([], [], [remastered], "2026-08-10", "2026-08-16").masteredCount).toBe(0);
  });
});

describe("safe inputs", () => {
  it("returns zero summaries for empty arrays and invalid calendar dates", () => {
    expect(summarizeDailyTraining("not-a-date", [], [])).toEqual({
      date: "not-a-date", activeSeconds: 0, completedGroups: 0, spokenCount: 0,
      masteredCount: 0, promotedCount: 0, lightDayUsed: false,
      streakQualified: false, fullGoalReached: false,
    });
    expect(summarizeWeek([], [], [], "2026-02-30")).toEqual({
      weekStart: "2026-02-30", activeSeconds: 0, completedGroups: 0,
      spokenCount: 0, masteredCount: 0, promotedCount: 0, retentionRate: undefined,
      forgettableCount: 0, weakPhraseIds: [],
    });
    expect(calculateStreak([], "invalid")).toEqual({ current: 0, lightDaysUsedThisWeek: 0 });
  });

  it("does not mutate event, session, or day inputs", () => {
    const events = [event("immutable", "phrase", "again", "2026-08-09T00:00:00.000Z", 300)];
    const sessions = [session("immutable", "2026-08-09T01:00:00.000Z")];
    const days = [day("2026-08-09", 300)];
    const before = structuredClone({ events, sessions, days });

    summarizeDailyTraining("2026-08-09", events, sessions);
    summarizeWeek(events, sessions, [], "2026-08-03");
    calculateStreak(days, "2026-08-09");

    expect({ events, sessions, days }).toEqual(before);
  });
});
