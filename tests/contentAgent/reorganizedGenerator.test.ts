import { describe, expect, it } from "vitest";
import { generateReorganizedContentSource } from "../../scripts/content-agent/reorganizedGenerator";
import { REORGANIZED_CORE_QUOTAS, REORGANIZED_SUBCATEGORIES } from "../../scripts/content-agent/reorganizedCatalog";
import { REORGANIZED_SCENARIO_GOALS } from "../../scripts/content-agent/reorganizedScenarioGoals";
import { containsPlaceholderOrBrandIdentifier, inspectSystemContent } from "../../scripts/content-agent/qualityGate";

describe("reorganized spoken-content source", () => {
  it("allocates 60 percent of core coverage to daily and social speech", () => {
    const source = generateReorganizedContentSource();
    const cores = source.phrases.filter(({ kind }) => kind === "core");
    const counts = Object.fromEntries(Object.keys(REORGANIZED_CORE_QUOTAS).map((category) => [
      category,
      cores.filter(({ categoryId }) => categoryId === category).length,
    ]));

    expect(counts).toEqual(REORGANIZED_CORE_QUOTAS);
    expect(counts.daily + counts.social).toBe(360);
    expect(cores).toHaveLength(600);
    expect(source.phrases).toHaveLength(2000);
  });

  it("covers every approved real-life scenario with new IDs", () => {
    const source = generateReorganizedContentSource();
    const cores = source.phrases.filter(({ kind }) => kind === "core");
    const actual = new Set(cores.map(({ categoryId, subcategory }) => `${categoryId}:${subcategory}`));

    expect(actual).toEqual(REORGANIZED_SUBCATEGORIES);
    expect(cores.every(({ id }) => id.startsWith("sys-v4-"))).toBe(true);
    expect(new Set(Object.keys(REORGANIZED_SCENARIO_GOALS))).toEqual(REORGANIZED_SUBCATEGORIES);
    expect(Object.values(REORGANIZED_SCENARIO_GOALS).every((goals) => goals.length === 10 && new Set(goals).size === 10)).toBe(true);
  });

  it("frames supply-chain speech as a China-based seller serving overseas buyers", () => {
    const supplySubcategories = [...REORGANIZED_SUBCATEGORIES].filter((value) => value.startsWith("supply-chain:"));

    expect(supplySubcategories).toEqual([
      "supply-chain:introducing-products-and-capability",
      "supply-chain:inquiries-quotes-and-terms",
      "supply-chain:samples-customization-and-quality",
      "supply-chain:orders-production-and-shipping",
    ]);
    expect(REORGANIZED_SCENARIO_GOALS["supply-chain:introducing-products-and-capability"]).toContain("explain the seller's China-based sourcing capability");
    expect(REORGANIZED_SCENARIO_GOALS["supply-chain:inquiries-quotes-and-terms"]).toContain("provide a quotation");
  });

  it("uses complete families with two or three ordered transfer examples", () => {
    const source = generateReorganizedContentSource();
    const cores = source.phrases.filter(({ kind }) => kind === "core");
    for (const core of cores) {
      const examples = source.phrases.filter(({ parentPhraseId }) => parentPhraseId === core.id);
      expect(examples.map(({ unlockOrder }) => unlockOrder)).toEqual(
        Array.from({ length: examples.length }, (_, index) => index + 1),
      );
      expect([2, 3]).toContain(examples.length);
    }
  });

  it("prevents generation briefs from passing the final v3 quality gate", () => {
    const source = generateReorganizedContentSource();
    const candidate = {
      ...source,
      qualityVersion: "qwen-plus-review-v3",
      phrases: source.phrases.map((phrase) => ({ ...phrase, qualityVersion: "qwen-plus-review-v3" })),
    };

    expect(inspectSystemContent(candidate).errors).toContain("content still contains generation briefs");
  });

  it("does not mistake normal follow-ups for the UPS brand", () => {
    expect(containsPlaceholderOrBrandIdentifier("Thanks for the thoughtful follow-ups.")).toBe(false);
    expect(containsPlaceholderOrBrandIdentifier("I'll send it through UPS.")).toBe(true);
  });
});
