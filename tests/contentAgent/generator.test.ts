import { describe, expect, it } from "vitest";
import { generateSystemContent } from "../../scripts/content-agent/generator";
import { inspectSystemContent } from "../../scripts/content-agent/qualityGate";

describe("offline content agent", () => {
  it("generates the approved category quotas and exactly 2000 linked phrases", () => {
    const content = generateSystemContent();
    const report = inspectSystemContent(content);
    expect(report.coreByCategory).toEqual({ daily: 180, travel: 100, work: 120, business: 100, "supply-chain": 70, social: 30 });
    expect(report.coreCount).toBe(600);
    expect(report.totalCount).toBe(2000);
    expect(report.errors).toEqual([]);
  });

  it("is deterministic and gives every core two or three ordered examples", () => {
    const first = generateSystemContent();
    expect(generateSystemContent()).toEqual(first);
    const cores = first.phrases.filter(({ kind }) => kind === "core");
    for (const core of cores) {
      const orders = first.phrases.filter(({ parentPhraseId }) => parentPhraseId === core.id).map(({ unlockOrder }) => unlockOrder);
      expect(orders).toEqual(Array.from({ length: orders.length }, (_, index) => index + 1));
      expect([2, 3]).toContain(orders.length);
    }
  });

  it("varies business and supply-chain sentence shapes and translates their full context", () => {
    const content = generateSystemContent();
    const packaging = content.phrases.filter(({ subcategory, kind }) => subcategory === "packaging review" && kind === "core");
    const pricing = content.phrases.filter(({ subcategory, kind }) => subcategory === "pricing" && kind === "core");

    expect(packaging).toHaveLength(8);
    expect(packaging.filter(({ english }) => english.startsWith("For packaging review,"))).toHaveLength(2);
    expect(packaging.every(({ chinese }) => chinese.includes("包装审核"))).toBe(true);
    expect(pricing.every(({ chinese }) => chinese.includes("价格协商"))).toBe(true);
  });

  it("rejects a mechanically repeated family with untranslated context", () => {
    const content = generateSystemContent();
    const broken = {
      ...content,
      phrases: content.phrases.map((phrase, index) => phrase.subcategory === "packaging review" && phrase.kind === "core"
        ? { ...phrase, english: `For packaging review, we need to inspect item ${index}.`, chinese: `我想检查项目${index}。` }
        : phrase),
    };

    expect(inspectSystemContent(broken).errors).toEqual(expect.arrayContaining([
      expect.stringContaining("repeated family opening: packaging review"),
      expect.stringContaining("missing translated context: packaging review"),
    ]));
  });
});
