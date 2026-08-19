import { describe, expect, it } from "vitest";
import type { SystemContentPackage, SystemContentPhrase } from "../../app/domain/types";
import { conflictingPhraseIds } from "../../scripts/repair-reorganized-content";

const phrase = (id: string, english: string, kind: "core" | "example" = "core", parentPhraseId?: string): SystemContentPhrase => ({
  id, english, chinese: `中文 ${id}`, categoryId: "daily", origin: "system", kind, parentPhraseId,
  ...(kind === "example" ? { unlockOrder: 1 } : {}), subcategory: "test", cefrLevel: "A2", intent: "test",
  contentVersion: "2026.08.4", qualityVersion: "qwen-plus-review-v3",
});

describe("reorganized content repair selection", () => {
  it("keeps one preferred core and selects duplicate examples or later cores for repair", () => {
    const phrases = [phrase("core-a", "That works for me."), phrase("example-a", "That works for me.", "example", "core-a"), phrase("core-b", "That works for me.")];
    const content: SystemContentPackage = { format: "phrase-bank-system-content", version: "2026.08.4", generatedAt: new Date().toISOString(), qualityVersion: "qwen-plus-review-v3", phrases };
    expect(conflictingPhraseIds(content)).toEqual(["example-a", "core-b"]);
  });

  it("selects placeholder or brand-dependent records for repair", () => {
    const phrases = [phrase("core-a", "Please use tracking #123 for the parcel.")];
    const content: SystemContentPackage = { format: "phrase-bank-system-content", version: "2026.08.4", generatedAt: new Date().toISOString(), qualityVersion: "qwen-plus-review-v3", phrases };
    expect(conflictingPhraseIds(content)).toContain("core-a");
  });
});
