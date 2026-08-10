import { describe, expect, it } from "vitest";
import { selectTrainingGroup } from "../../app/domain/trainingSelection";
import type { Phrase } from "../../app/domain/types";

const now = new Date("2026-08-09T12:00:00.000Z");

function reviewedPhrase(id: string, masteryLevel: number, nextReviewAt: string): Phrase {
  return {
    id,
    english: `English ${id}`,
    chinese: `Chinese ${id}`,
    categoryId: "category-1",
    reviewStep: 1,
    masteryLevel,
    nextReviewAt,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    lastReviewedAt: "2026-08-08T00:00:00.000Z",
  };
}

function newPhrase(id: string): Phrase {
  const phrase = reviewedPhrase(
    id,
    0,
    "2026-08-01T00:00:00.000Z",
  );
  delete phrase.lastReviewedAt;
  return phrase;
}

describe("selectTrainingGroup", () => {
  it("selects the standard allocation of six due, two weak, and two mature phrases", () => {
    const phrases = [
      ...Array.from({ length: 8 }, (_, index) =>
        reviewedPhrase(`due-${index}`, 2, "2026-08-09T11:00:00.000Z"),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        reviewedPhrase(`weak-${index}`, 1, "2026-08-10T12:00:00.000Z"),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        reviewedPhrase(`mature-${index}`, 3, "2026-08-10T12:00:00.000Z"),
      ),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "standard",
      now,
      seed: "standard-seed",
      newIntroducedToday: 0,
    });

    expect(result).toHaveLength(10);
    expect(result.filter(({ source }) => source === "due")).toHaveLength(6);
    expect(result.filter(({ source }) => source === "weak")).toHaveLength(2);
    expect(result.filter(({ source }) => source === "mature")).toHaveLength(2);
  });

  it("selects two due and one weak phrase in quick mode", () => {
    const phrases = [
      ...Array.from({ length: 4 }, (_, index) =>
        reviewedPhrase(`quick-due-${index}`, 1, "2026-08-09T11:00:00.000Z"),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        reviewedPhrase(`quick-weak-${index}`, 0, "2026-08-10T12:00:00.000Z"),
      ),
      reviewedPhrase("quick-mature", 3, "2026-08-10T12:00:00.000Z"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "quick-seed", newIntroducedToday: 0,
    });

    expect(result).toHaveLength(3);
    expect(result.filter(({ source }) => source === "due")).toHaveLength(2);
    expect(result.filter(({ source }) => source === "weak")).toHaveLength(1);
    expect(result.filter(({ source }) => source === "mature")).toHaveLength(0);
  });

  it("caps new phrases at the remaining daily allowance", () => {
    const phrases = Array.from({ length: 5 }, (_, index) => newPhrase(`new-${index}`));

    expect(selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "new-seed", newIntroducedToday: 2,
    })).toHaveLength(1);
    expect(selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "new-seed", newIntroducedToday: 3,
    })).toHaveLength(0);
  });

  it("backfills a scarce due quota from reviewed future pools", () => {
    const phrases = [
      reviewedPhrase("only-due", 1, "2026-08-09T11:00:00.000Z"),
      ...Array.from({ length: 5 }, (_, index) =>
        reviewedPhrase(`backfill-weak-${index}`, index === 4 ? 2 : 1, "2026-08-10T12:00:00.000Z"),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        reviewedPhrase(`backfill-mature-${index}`, 3, "2026-08-10T12:00:00.000Z"),
      ),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "backfill-seed", newIntroducedToday: 0,
    });

    expect(result).toHaveLength(10);
    expect(result.filter(({ source }) => source === "due")).toHaveLength(1);
    expect(result.find(({ phrase }) => phrase.masteryLevel === 2)?.source).toBe("weak");
  });

  it("never returns duplicate phrase IDs", () => {
    const duplicate = reviewedPhrase("duplicate", 1, "2026-08-09T11:00:00.000Z");
    const phrases = [duplicate, { ...duplicate }, ...Array.from({ length: 12 }, (_, index) =>
      reviewedPhrase(`unique-${index}`, index % 4, index < 6
        ? "2026-08-09T11:00:00.000Z"
        : "2026-08-10T12:00:00.000Z"),
    )];

    const result = selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "dedupe-seed", newIntroducedToday: 0,
    });
    const ids = result.map(({ phrase }) => phrase.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders deterministically by seed", () => {
    const phrases = Array.from({ length: 30 }, (_, index) =>
      reviewedPhrase(`ordered-${index}`, 1, "2026-08-09T11:00:00.000Z"),
    );
    const idsFor = (seed: string) => selectTrainingGroup(phrases, {
      mode: "standard", now, seed, newIntroducedToday: 0,
    }).map(({ phrase }) => phrase.id);

    expect(idsFor("seed-a")).toEqual(idsFor("seed-a"));
    expect(idsFor("seed-a")).not.toEqual(idsFor("seed-b"));
  });

  it("prefers phrases not practiced today when alternatives are available", () => {
    const phrases = [
      ...Array.from({ length: 8 }, (_, index) =>
        reviewedPhrase(`rotate-due-${index}`, 1, "2026-08-09T11:00:00.000Z"),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        reviewedPhrase(`rotate-weak-${index}`, 1, "2026-08-10T12:00:00.000Z"),
      ),
    ];
    const first = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "same-day", newIntroducedToday: 0,
    });
    const practicedTodayIds = new Set(first.map(({ phrase }) => phrase.id));

    const second = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "same-day", newIntroducedToday: 0, practicedTodayIds,
    });

    expect(second).toHaveLength(3);
    expect(second.every(({ phrase }) => !practicedTodayIds.has(phrase.id))).toBe(true);
  });

  it("backfills from phrases practiced today when the remaining inventory is short", () => {
    const phrases = [
      reviewedPhrase("repeat-due-1", 1, "2026-08-09T11:00:00.000Z"),
      reviewedPhrase("repeat-due-2", 1, "2026-08-09T11:00:00.000Z"),
      reviewedPhrase("repeat-weak", 1, "2026-08-10T12:00:00.000Z"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "quick",
      now,
      seed: "short-inventory",
      newIntroducedToday: 0,
      practicedTodayIds: new Set(phrases.map((phrase) => phrase.id)),
    });

    expect(result).toHaveLength(3);
    expect(new Set(result.map(({ phrase }) => phrase.id))).toEqual(new Set(phrases.map((phrase) => phrase.id)));
  });

  it("does not mutate phrases or options", () => {
    const phrases = [
      reviewedPhrase("immutable-due", 1, "2026-08-09T11:00:00.000Z"),
      reviewedPhrase("immutable-weak", 0, "2026-08-10T12:00:00.000Z"),
      newPhrase("immutable-new"),
    ];
    const options = { mode: "standard" as const, now, seed: "immutable", newIntroducedToday: 1 };
    const phrasesBefore = structuredClone(phrases);
    const optionsBefore = { ...options, now: new Date(options.now) };

    selectTrainingGroup(phrases, options);

    expect(phrases).toEqual(phrasesBefore);
    expect(options).toEqual(optionsBefore);
  });
});
