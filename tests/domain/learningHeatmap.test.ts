import { describe, expect, it } from "vitest";
import { buildLearningHeatmap, heatLevel } from "../../app/domain/learningHeatmap";
import type { ReviewResult, TrainingEvent, TrainingSource } from "../../app/domain/types";

function event(
  id: string,
  phraseId: string,
  occurredAt: string,
  source: TrainingSource = "due",
  result: ReviewResult = "good",
): TrainingEvent {
  return {
    id,
    sessionId: `session-${id}`,
    phraseId,
    source,
    result,
    usedPronunciationHint: false,
    recorded: false,
    activeSeconds: 0,
    occurredAt,
  };
}

describe("buildLearningHeatmap", () => {
  it("builds exactly twelve Monday-first weeks around the current Shanghai week", () => {
    const days = buildLearningHeatmap([], new Date("2026-08-11T08:00:00.000Z"));

    expect(days).toHaveLength(84);
    expect(days[0]).toEqual({ date: "2026-05-25", count: 0, level: 0, future: false });
    expect(days.at(-1)).toEqual({ date: "2026-08-16", count: 0, level: 0, future: true });
    expect(days.find((day) => day.date === "2026-08-11")?.future).toBe(false);
    expect(days.find((day) => day.date === "2026-08-12")?.future).toBe(true);
  });

  it("deduplicates phrase ids within each Shanghai calendar day", () => {
    const events = [
      event("before-one", "p1", "2026-08-10T15:59:00.000Z"),
      event("before-two", "p1", "2026-08-10T15:59:30.000Z"),
      event("after-p1", "p1", "2026-08-10T16:00:00.000Z"),
      event("after-p2", "p2", "2026-08-10T16:00:30.000Z"),
    ];

    const days = buildLearningHeatmap(events, new Date("2026-08-11T08:00:00.000Z"));

    expect(days.find((day) => day.date === "2026-08-10")?.count).toBe(1);
    expect(days.find((day) => day.date === "2026-08-11")?.count).toBe(2);
  });

  it("ignores malformed, blank, future, and out-of-window events", () => {
    const events = [
      event("valid", "kept", "2026-08-11T07:59:00.000Z"),
      event("invalid", "invalid", "not-a-date"),
      event("blank", "   ", "2026-08-11T07:00:00.000Z"),
      event("future", "future", "2026-08-11T16:00:00.000Z"),
      event("outside", "outside", "2026-05-24T15:59:59.000Z"),
    ];

    const days = buildLearningHeatmap(events, new Date("2026-08-11T08:00:00.000Z"));

    expect(days.reduce((total, day) => total + day.count, 0)).toBe(1);
    expect(days.find((day) => day.date === "2026-08-11")?.count).toBe(1);
  });

  it("ignores runtime-corrupted fields without hiding valid events", () => {
    const corruptedPhraseId = {
      ...event("bad-phrase", "placeholder", "2026-08-11T07:00:00.000Z"),
      phraseId: 42,
    } as unknown as TrainingEvent;
    const corruptedOccurredAt = {
      ...event("bad-date", "bad-date", "2026-08-11T07:00:00.000Z"),
      occurredAt: {},
    } as unknown as TrainingEvent;
    const events = [
      corruptedPhraseId,
      corruptedOccurredAt,
      event("valid-among-corruption", "kept", "2026-08-11T07:59:00.000Z"),
    ];

    expect(() => buildLearningHeatmap(
      events,
      new Date("2026-08-11T08:00:00.000Z"),
    )).not.toThrow();
    const days = buildLearningHeatmap(events, new Date("2026-08-11T08:00:00.000Z"));
    expect(days.find((day) => day.date === "2026-08-11")?.count).toBe(1);
  });

  it("counts persisted events independently of every source and review result variant", () => {
    const fixtures: Array<[TrainingSource, ReviewResult]> = [
      ["due", "again"],
      ["weak", "hard"],
      ["mature", "good"],
      ["new", "again"],
      ["requeue", "hard"],
    ];
    const events = fixtures.map(([source, result], index) =>
      event(`variant-${index}`, `phrase-${index}`, `2026-08-11T0${index}:00:00.000Z`, source, result));

    const days = buildLearningHeatmap(events, new Date("2026-08-11T08:00:00.000Z"));

    expect(days.find((day) => day.date === "2026-08-11")?.count).toBe(fixtures.length);
  });
});

describe("heatLevel", () => {
  it.each([
    [0, 0], [1, 1], [2, 1], [3, 2], [5, 2],
    [6, 3], [9, 3], [10, 4], [99, 4],
  ] as const)("maps %i events to level %i", (count, expected) => {
    expect(heatLevel(count)).toBe(expected);
  });
});
