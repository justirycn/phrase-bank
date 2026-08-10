import { describe, expect, it } from "vitest";
import { personalPhraseDefaults, validateSystemContentPackage } from "../../app/domain/systemContent";
import type { SystemContentPackage } from "../../app/domain/types";

const validPackage = (): SystemContentPackage => ({
  format: "phrase-bank-system-content",
  version: "2026.08.1",
  generatedAt: "2026-08-10T00:00:00.000Z",
  qualityVersion: "quality-v1",
  phrases: [
    { id: "daily-reply", english: "I'll get back to you.", chinese: "我稍后回复你。", categoryId: "daily", origin: "system", kind: "core", subcategory: "arrangements", cefrLevel: "A2", intent: "follow-up", contentVersion: "2026.08.1", qualityVersion: "quality-v1" },
    { id: "daily-reply-1", english: "I'll get back to you tomorrow.", chinese: "我明天回复你。", categoryId: "daily", origin: "system", kind: "example", parentPhraseId: "daily-reply", unlockOrder: 1, subcategory: "arrangements", cefrLevel: "A2", intent: "follow-up", contentVersion: "2026.08.1", qualityVersion: "quality-v1" },
    { id: "daily-reply-2", english: "Let me check and get back to you.", chinese: "让我确认一下再回复你。", categoryId: "daily", origin: "system", kind: "example", parentPhraseId: "daily-reply", unlockOrder: 2, subcategory: "arrangements", cefrLevel: "B1", intent: "follow-up", contentVersion: "2026.08.1", qualityVersion: "quality-v1" },
  ],
});

describe("system content packages", () => {
  it("accepts a valid core with ordered examples", () => {
    expect(validateSystemContentPackage(validPackage())).toEqual(validPackage());
  });

  it.each([
    ["duplicate IDs", (value: SystemContentPackage) => value.phrases.push({ ...value.phrases[0] })],
    ["missing parent", (value: SystemContentPackage) => { value.phrases[1].parentPhraseId = "missing"; }],
    ["non-contiguous order", (value: SystemContentPackage) => { value.phrases[2].unlockOrder = 3; }],
    ["invalid CEFR", (value: SystemContentPackage) => { value.phrases[0].cefrLevel = "C1" as "A2"; }],
  ])("rejects %s before persistence", (_, mutate) => {
    const value = validPackage();
    mutate(value);
    expect(() => validateSystemContentPackage(value)).toThrow("系统内容包无效");
  });

  it("defaults user-created phrases to personal standalone content", () => {
    expect(personalPhraseDefaults()).toEqual({ origin: "personal", kind: "standalone" });
  });
});
