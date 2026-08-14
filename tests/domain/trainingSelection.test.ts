import { describe, expect, it } from "vitest";
import { selectTrainingGroup } from "../../app/domain/trainingSelection";
import type { LearningStage, Phrase, PhraseLearningState } from "../../app/domain/types";

const now = new Date("2026-08-09T12:00:00.000Z");

function phrase(
  id: string,
  masteryLevel = 1,
  nextReviewAt = "2026-08-09T11:00:00.000Z",
  lastReviewedAt: string | undefined = "2026-08-08T00:00:00.000Z",
): Phrase {
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
    lastReviewedAt,
  };
}

function state(id: string, stage: LearningStage, unlockedAt?: string): PhraseLearningState {
  return {
    phraseId: id,
    stage,
    consecutiveGood: stage === "mastered" ? 3 : 0,
    masteredDates: stage === "mastered" ? ["2026-08-08"] : [],
    unlockedAt,
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

const eligibleStates = (phrases: Phrase[], stage: "learned" | "mastered" = "learned") =>
  phrases.map((item) => state(item.id, stage));

describe("selectTrainingGroup", () => {
  it.each(["standard", "quick"] as const)("only selects learned or mastered phrases in %s practice", (mode) => {
    const phrases = [
      phrase("missing-state", 1, "2026-08-09T10:00:00.000Z", "2026-08-07T00:00:00.000Z"),
      phrase("unseen-with-review", 1, "2026-08-09T10:00:00.000Z", "2026-08-07T00:00:00.000Z"),
      phrase("learning-with-review", 1, "2026-08-09T10:00:00.000Z", "2026-08-07T00:00:00.000Z"),
      phrase("learned"),
      phrase("mastered", 3, "2026-08-12T00:00:00.000Z"),
    ];
    const learningStates = [
      state("unseen-with-review", "unseen"),
      state("learning-with-review", "learning"),
      state("learned", "learned"),
      state("mastered", "mastered"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode, now, seed: "eligibility", newIntroducedToday: 0, learningStates,
    });

    expect(new Set(result.map(({ phrase: item }) => item.id))).toEqual(
      new Set(mode === "standard" ? ["learned"] : ["learned", "mastered"]),
    );
    expect(result.every(({ source }) => source !== "new")).toBe(true);
  });

  it("requires a learned stage and unlock timestamp for a system example", () => {
    const phrases = [
      { ...phrase("locked-learned"), origin: "system" as const, kind: "example" as const },
      { ...phrase("unlocked-learning"), origin: "system" as const, kind: "example" as const },
      { ...phrase("unlocked-learned"), origin: "system" as const, kind: "example" as const },
      { ...phrase("core-learned"), origin: "system" as const, kind: "core" as const },
    ];
    const learningStates = [
      state("locked-learned", "learned"),
      state("unlocked-learning", "learning", "2026-08-07T00:00:00.000Z"),
      state("unlocked-learned", "learned", "2026-08-07T00:00:00.000Z"),
      state("core-learned", "learned"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "examples", newIntroducedToday: 0, learningStates,
    });

    expect(new Set(result.map(({ phrase: item }) => item.id))).toEqual(new Set(["unlocked-learned", "core-learned"]));
  });

  it("keeps standard review due-only while preserving personal due phrases", () => {
    const personal = Array.from({ length: 6 }, (_, index) => ({
      ...phrase(`personal-${index}`, index < 3 ? 1 : 3, index < 3 ? "2026-08-08T00:00:00.000Z" : "2026-08-12T00:00:00.000Z"),
      origin: "personal" as const,
      kind: "standalone" as const,
    }));
    const systemDue = Array.from({ length: 5 }, (_, index) => ({ ...phrase(`system-due-${index}`), origin: "system" as const, kind: "core" as const }));
    const systemWeak = Array.from({ length: 3 }, (_, index) => ({ ...phrase(`system-weak-${index}`, 2, "2026-08-12T00:00:00.000Z"), origin: "system" as const, kind: "core" as const }));
    const systemMature = Array.from({ length: 3 }, (_, index) => ({ ...phrase(`system-mature-${index}`, 3, "2026-08-12T00:00:00.000Z"), origin: "system" as const, kind: "core" as const }));
    const unseen = { ...phrase("system-unseen"), origin: "system" as const, kind: "core" as const };
    const phrases = [...personal, ...systemDue, ...systemWeak, ...systemMature, unseen];

    const result = selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "standard", newIntroducedToday: 0,
      learningStates: [...eligibleStates(phrases.filter((item) => item.id !== unseen.id)), state(unseen.id, "unseen")],
    });

    expect(result).toHaveLength(8);
    expect(result.filter(({ phrase: item }) => item.origin === "personal")).toHaveLength(3);
    expect(result.every(({ source }) => source === "due")).toBe(true);
    expect(result.map(({ phrase: item }) => item.id)).not.toContain(unseen.id);
  });

  it("keeps due review empty instead of backfilling phrases scheduled for the future", () => {
    const due = phrase("due-now", 3, "2026-08-09T10:00:00.000Z");
    const futureWeak = phrase("future-weak", 1, "2026-08-12T00:00:00.000Z");
    const futureMature = phrase("future-mature", 3, "2026-08-20T00:00:00.000Z");
    const phrases = [due, futureWeak, futureMature];

    expect(selectTrainingGroup(phrases, {
      mode: "standard", now, seed: "due-only", newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
    }).map(({ phrase: item, source }) => [item.id, source])).toEqual([["due-now", "due"]]);

    expect(selectTrainingGroup([futureWeak, futureMature], {
      mode: "standard", now, seed: "empty-due", newIntroducedToday: 0,
      learningStates: eligibleStates([futureWeak, futureMature]),
    })).toEqual([]);
  });

  it("includes a phrase scheduled later on the same Shanghai day", () => {
    const laterToday = phrase("later-today", 1, "2026-08-09T15:30:00.000Z");
    const tomorrow = phrase("tomorrow", 1, "2026-08-09T16:00:00.000Z");

    expect(selectTrainingGroup([laterToday, tomorrow], {
      mode: "standard", now, seed: "calendar-day", newIntroducedToday: 0,
      learningStates: eligibleStates([laterToday, tomorrow]),
    }).map(({ phrase: item, source }) => [item.id, source])).toEqual([["later-today", "due"]]);
  });

  it("prioritizes due, then weak, then the least recently reviewed mature phrases", () => {
    const phrases = [
      phrase("due", 3, "2026-08-09T10:00:00.000Z", "2026-08-09T00:00:00.000Z"),
      phrase("weak", 2, "2026-08-12T00:00:00.000Z", "2026-08-09T00:00:00.000Z"),
      phrase("mature-old", 3, "2026-08-12T00:00:00.000Z", "2026-07-01T00:00:00.000Z"),
      phrase("mature-new", 3, "2026-08-12T00:00:00.000Z", "2026-08-08T00:00:00.000Z"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "priority", newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
    });

    expect(result.map(({ phrase: item }) => item.id)).toEqual(["due", "weak", "mature-old"]);
    expect(new Set(result.map(({ phrase: item }) => item.id)).size).toBe(3);
  });

  it("orders mature review times by epoch across mixed timezone offsets", () => {
    const phrases = [
      phrase("very-old", 3, "2026-08-12T00:00:00.000Z", "2026-07-01T01:00:00.000Z"),
      phrase("offset-older", 3, "2026-08-12T00:00:00.000Z", "2026-07-01T10:00:00+08:00"),
      phrase("middle", 3, "2026-08-12T00:00:00.000Z", "2026-07-01T02:30:00.000Z"),
      phrase("z-newer", 3, "2026-08-12T00:00:00.000Z", "2026-07-01T03:00:00.000Z"),
    ];

    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "timezone-order", newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
    });

    expect(result.map(({ phrase: item }) => item.id)).toEqual(["very-old", "offset-older", "middle"]);
  });

  it("excludes today's latest-good phrases and the immediately previous group", () => {
    const phrases = Array.from({ length: 7 }, (_, index) => phrase(`gap-${index}`));
    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "gap", newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
      goodTodayIds: new Set(["gap-0"]),
      previousGroupIds: new Set(["gap-1", "gap-2", "gap-3"]),
    });

    expect(result).toHaveLength(3);
    expect(result.map(({ phrase: item }) => item.id)).not.toContain("gap-0");
    expect(result.every(({ phrase: item }) => !new Set(["gap-1", "gap-2", "gap-3"]).has(item.id))).toBe(true);
  });

  it("backfills hard or again phrases practiced today only after fresh inventory", () => {
    const phrases = [phrase("fresh"), phrase("prior-hard"), phrase("older-hard"), phrase("older-again")];
    const result = selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "backfill", newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
      practicedTodayIds: new Set(["prior-hard", "older-hard", "older-again"]),
      previousGroupIds: new Set(["prior-hard"]),
    });

    expect(result).toHaveLength(3);
    expect(result[0].phrase.id).toBe("fresh");
    expect(new Set(result.slice(1).map(({ phrase: item }) => item.id))).toEqual(new Set(["older-hard", "older-again"]));
  });

  it("returns a short or empty queue instead of filling with ineligible phrases", () => {
    const eligible = phrase("eligible");
    const unseen = phrase("unseen", 1, "2026-08-09T10:00:00.000Z", undefined);

    expect(selectTrainingGroup([eligible, unseen], {
      mode: "quick", now, seed: "short", newIntroducedToday: 0,
      learningStates: [state(eligible.id, "learned"), state(unseen.id, "unseen")],
    }).map(({ phrase: item }) => item.id)).toEqual([eligible.id]);
    expect(selectTrainingGroup([unseen], {
      mode: "quick", now, seed: "empty", newIntroducedToday: 0,
      learningStates: [state(unseen.id, "learning")],
    })).toEqual([]);
  });

  it("is deterministic for one cursor and rotates mature phrases with distinct review times", () => {
    const phrases = Array.from({ length: 12 }, (_, index) => phrase(
      `cursor-${index}`,
      3,
      "2026-08-12T00:00:00.000Z",
      `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    ));
    const idsFor = (rotationCursor: number) => selectTrainingGroup(phrases, {
      mode: "quick", now, seed: "cursor", rotationCursor, newIntroducedToday: 0,
      learningStates: eligibleStates(phrases),
    }).map(({ phrase: item }) => item.id);

    expect(idsFor(0)).toEqual(idsFor(0));
    expect(idsFor(0)).not.toEqual(idsFor(1));
  });

  it("does not mutate phrases, learning states, or selection options", () => {
    const phrases = [phrase("immutable-a"), phrase("immutable-b", 3, "2026-08-12T00:00:00.000Z")];
    const learningStates = eligibleStates(phrases);
    const options = {
      mode: "quick" as const, now, seed: "immutable", rotationCursor: 2, newIntroducedToday: 0,
      learningStates, practicedTodayIds: new Set(["immutable-a"]), previousGroupIds: new Set<string>(),
      goodTodayIds: new Set<string>(),
    };
    const phrasesBefore = structuredClone(phrases);
    const statesBefore = structuredClone(learningStates);
    const optionSetsBefore = {
      practiced: [...options.practicedTodayIds], previous: [...options.previousGroupIds], good: [...options.goodTodayIds],
    };

    selectTrainingGroup(phrases, options);

    expect(phrases).toEqual(phrasesBefore);
    expect(learningStates).toEqual(statesBefore);
    expect([...options.practicedTodayIds]).toEqual(optionSetsBefore.practiced);
    expect([...options.previousGroupIds]).toEqual(optionSetsBefore.previous);
    expect([...options.goodTodayIds]).toEqual(optionSetsBefore.good);
  });
});
