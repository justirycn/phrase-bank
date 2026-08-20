import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_SYSTEM_CONTENT_VERSION } from "../../app/domain/bundledSystemContent";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";
import { REORGANIZED_SUBCATEGORIES } from "../../scripts/content-agent/reorganizedCatalog";

const artifact = resolve(process.cwd(), "public/content/system-content-2026.08.2.json");

describe("published system content package", () => {
  it("matches deterministic generation and passes the independent quality gate", () => {
    const raw = readFileSync(artifact, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(generateSystemContent());
    expect(inspectSystemContent(parsed).errors).toEqual([]);
    expect(raw).toBe(`${JSON.stringify(generateSystemContent(), null, 2)}\n`);
  });
});

describe("current bundled content package", () => {
  it("publishes the seller-oriented supply-chain scenarios in the bundled version", () => {
    const currentArtifact = resolve(process.cwd(), `public/content/system-content-${BUNDLED_SYSTEM_CONTENT_VERSION}.json`);
    const parsed = JSON.parse(readFileSync(currentArtifact, "utf8"));
    const supplyPhrases = parsed.phrases.filter(({ categoryId }: { categoryId: string }) => categoryId === "supply-chain");
    const supplySubcategories = new Set(supplyPhrases.map(({ subcategory }: { subcategory: string }) => `supply-chain:${subcategory}`));

    expect(inspectSystemContent(parsed).errors).toEqual([]);
    expect(supplyPhrases).toHaveLength(130);
    expect(supplySubcategories).toEqual(new Set([...REORGANIZED_SUBCATEGORIES].filter((value) => value.startsWith("supply-chain:"))));
    expect(supplyPhrases.some(({ english }: { english: string }) => english === "What kind of product are you looking for?")).toBe(true);
    expect(supplyPhrases.every(({ subcategory }: { subcategory: string }) => !["product-requirements", "samples-and-quality", "orders-and-production", "shipping-and-delivery"].includes(subcategory))).toBe(true);
  });
});
