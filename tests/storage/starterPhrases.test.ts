import { describe, expect, it } from "vitest";
import { STARTER_PHRASES } from "../../app/storage/starterPhrases";

describe("starter phrase pack", () => {
  it("contains 40 unique and complete phrases", () => {
    expect(STARTER_PHRASES).toHaveLength(40);
    expect(new Set(STARTER_PHRASES.map((phrase) => phrase.id)).size).toBe(40);
    expect(STARTER_PHRASES.every((phrase) =>
      phrase.id.startsWith("starter-") &&
      phrase.english.trim().length > 0 &&
      phrase.chinese.trim().length > 0 &&
      phrase.personalExample.trim().length > 0,
    )).toBe(true);
  });

  it("uses the confirmed daily, travel and social distribution", () => {
    const counts = STARTER_PHRASES.reduce<Record<string, number>>((result, phrase) => {
      result[phrase.categoryId] = (result[phrase.categoryId] ?? 0) + 1;
      return result;
    }, {});
    expect(counts).toEqual({ daily: 24, travel: 12, social: 4 });
  });
});
