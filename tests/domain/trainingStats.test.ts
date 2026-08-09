import { describe, expect, it } from "vitest";
import {
  calculateStreak,
  summarizeDailyTraining,
  summarizeWeek,
} from "../../app/domain/trainingStats";
import type {
  DailyTrainingSummary,
  ReviewResult,
  TrainingEvent,
  TrainingSessionRecord,
} from "../../app/domain/types";

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
  it("uses seven inclusive Shanghai dates and reports promotions and weak top three", () => {
    const events = [
      event("before", "promoted", "again", "2026-08-02T15:59:59.000Z", 100, true),
      event("start", "promoted", "good", "2026-08-02T16:00:00.000Z", 200, true),
      event("again-z", "zeta", "again", "2026-08-04T00:00:00.000Z", 300),
      event("again-a", "alpha", "again", "2026-08-05T00:00:00.000Z", 400),
      event("hard-a", "alpha", "hard", "2026-08-06T00:00:00.000Z", 500),
      event("hard-b", "beta", "hard", "2026-08-07T00:00:00.000Z", 600),
      event("hard-c", "charlie", "hard", "2026-08-08T00:00:00.000Z", 700),
      event("end", "omega", "good", "2026-08-09T15:59:59.000Z", 800),
      event("after", "outside", "again", "2026-08-09T16:00:00.000Z", 900),
    ];
    const sessions = [
      session("start", "2026-08-02T16:00:00.000Z"),
      session("end", "2026-08-09T15:59:59.000Z"),
      session("after", "2026-08-09T16:00:00.000Z"),
    ];

    expect(summarizeWeek(events, sessions, "2026-08-03")).toEqual({
      weekStart: "2026-08-03",
      activeSeconds: 3500,
      completedGroups: 2,
      spokenCount: 1,
      masteredCount: 2,
      promotedCount: 1,
      weakPhraseIds: ["alpha", "zeta", "beta"],
    });
  });
});

describe("safe inputs", () => {
  it("returns zero summaries for empty arrays and invalid calendar dates", () => {
    expect(summarizeDailyTraining("not-a-date", [], [])).toEqual({
      date: "not-a-date", activeSeconds: 0, completedGroups: 0, spokenCount: 0,
      masteredCount: 0, promotedCount: 0, lightDayUsed: false,
      streakQualified: false, fullGoalReached: false,
    });
    expect(summarizeWeek([], [], "2026-02-30")).toEqual({
      weekStart: "2026-02-30", activeSeconds: 0, completedGroups: 0,
      spokenCount: 0, masteredCount: 0, promotedCount: 0, weakPhraseIds: [],
    });
    expect(calculateStreak([], "invalid")).toEqual({ current: 0, lightDaysUsedThisWeek: 0 });
  });

  it("does not mutate event, session, or day inputs", () => {
    const events = [event("immutable", "phrase", "again", "2026-08-09T00:00:00.000Z", 300)];
    const sessions = [session("immutable", "2026-08-09T01:00:00.000Z")];
    const days = [day("2026-08-09", 300)];
    const before = structuredClone({ events, sessions, days });

    summarizeDailyTraining("2026-08-09", events, sessions);
    summarizeWeek(events, sessions, "2026-08-03");
    calculateStreak(days, "2026-08-09");

    expect({ events, sessions, days }).toEqual(before);
  });
});
