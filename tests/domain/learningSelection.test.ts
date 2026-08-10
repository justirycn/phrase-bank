import { describe, expect, it } from "vitest";
import { previewLearningGroup, selectLearningGroup } from "../../app/domain/learningSelection";
import type { Phrase, PhraseLearningState } from "../../app/domain/types";

const timestamp = "2026-08-10T08:00:00.000Z";

function phrase(
  id: string,
  overrides: Partial<Phrase> = {},
): Phrase {
  return {
    id,
    english: `English ${id}`,
    chinese: `Chinese ${id}`,
    categoryId: "travel",
    origin: "system",
    kind: "core",
    reviewStep: 0,
    masteryLevel: 0,
    nextReviewAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function state(
  phraseId: string,
  stage: PhraseLearningState["stage"],
): PhraseLearningState {
  return {
    phraseId,
    stage,
    consecutiveGood: 0,
    masteredDates: [],
    updatedAt: timestamp,
  };
}

const options = {
  date: "2026-08-10",
  themeCategoryId: "travel",
  target: 5,
};

describe("selectLearningGroup", () => {
  it("rotates sorted system themes before personal fallback and returns the actual capped preview", () => {
    const phrases = [
      phrase("daily", { categoryId: "daily" }), phrase("travel", { categoryId: "travel" }),
      phrase("work-a", { categoryId: "work" }), phrase("work-b", { categoryId: "work" }),
      phrase("personal", { categoryId: "daily", origin: "personal", kind: "standalone" }),
    ];
    const preview = previewLearningGroup(phrases, [], ["daily", "travel", "work"], { date: "2026-08-10", remaining: 2 });
    expect(preview.themeCategoryId).toBe("work");
    expect(preview.phrases).toHaveLength(2);
    expect(preview.phrases.some(({ categoryId }) => categoryId === "work")).toBe(true);
  });
  it("selects unlearned personal standalone phrases first, newest first", () => {
    const result = selectLearningGroup([
      phrase("system"),
      phrase("personal-old", {
        origin: "personal", kind: "standalone", createdAt: "2026-08-08T08:00:00.000Z",
      }),
      phrase("personal-new", {
        origin: "personal", kind: "standalone", createdAt: "2026-08-09T08:00:00.000Z",
      }),
    ], [], { ...options, target: 2 });

    expect(result.map(({ id }) => id)).toEqual(["personal-new", "personal-old"]);
  });

  it("uses same-theme system core phrases before other themes", () => {
    const result = selectLearningGroup([
      phrase("other-a", { categoryId: "work" }),
      phrase("same-a"),
      phrase("other-b", { categoryId: "daily" }),
      phrase("same-b"),
    ], [], { ...options, target: 3 });

    expect(result.slice(0, 2).map(({ id }) => id).sort()).toEqual(["same-a", "same-b"]);
    expect(["other-a", "other-b"]).toContain(result[2]?.id);
  });

  it("backfills from other-theme system core phrases and returns a short group when inventory is scarce", () => {
    const result = selectLearningGroup([
      phrase("same"),
      phrase("other", { categoryId: "work" }),
    ], [], options);

    expect(result.map(({ id }) => id)).toEqual([
      "same",
      "other",
    ]);
  });

  it("excludes in-progress or completed states, retired phrases, system examples, and reserved IDs", () => {
    const result = selectLearningGroup([
      phrase("unseen"),
      phrase("learning"),
      phrase("learned"),
      phrase("mastered"),
      phrase("retired", { retiredAt: timestamp }),
      phrase("example", { kind: "example" }),
      phrase("reserved"),
    ], [
      state("unseen", "unseen"),
      state("learning", "learning"),
      state("learned", "learned"),
      state("mastered", "mastered"),
    ], { ...options, reservedPhraseIds: new Set(["reserved"]) });

    expect(result.map(({ id }) => id)).toEqual(["unseen"]);
  });

  it("treats missing origin and kind as a legacy personal standalone phrase", () => {
    const legacy = phrase("legacy", { origin: undefined, kind: undefined });

    expect(selectLearningGroup([phrase("system"), legacy], [], { ...options, target: 1 }))
      .toEqual([legacy]);
  });

  it("orders the system pool deterministically for the same date", () => {
    const phrases = Array.from({ length: 12 }, (_, index) => phrase(`system-${index}`));
    const first = selectLearningGroup(phrases, [], options).map(({ id }) => id);
    const second = selectLearningGroup(phrases, [], options).map(({ id }) => id);

    expect(first).toEqual(second);
  });

  it("deduplicates phrase IDs and never exceeds the target", () => {
    const duplicate = phrase("duplicate");
    const result = selectLearningGroup([
      duplicate,
      { ...duplicate },
      ...Array.from({ length: 8 }, (_, index) => phrase(`unique-${index}`)),
    ], [], { ...options, target: 5 });

    expect(result).toHaveLength(5);
    expect(new Set(result.map(({ id }) => id))).toHaveLength(5);
  });

  it("does not mutate phrases, states, or options", () => {
    const phrases = [
      phrase("personal", { origin: "personal", kind: "standalone" }),
      phrase("system"),
    ];
    const states = [state("system", "unseen")];
    const selectionOptions = { ...options, reservedPhraseIds: new Set(["not-present"]) };
    const phrasesBefore = structuredClone(phrases);
    const statesBefore = structuredClone(states);
    const optionsBefore = {
      ...selectionOptions,
      reservedPhraseIds: new Set(selectionOptions.reservedPhraseIds),
    };

    selectLearningGroup(phrases, states, selectionOptions);

    expect(phrases).toEqual(phrasesBefore);
    expect(states).toEqual(statesBefore);
    expect(selectionOptions).toEqual(optionsBefore);
  });
});
