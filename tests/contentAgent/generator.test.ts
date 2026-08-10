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
});
