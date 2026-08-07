import { describe, expect, it } from "vitest";
import { parseBackup } from "../../app/storage/backup";

const valid = {
  format: "personal-phrase-bank",
  version: 1,
  exportedAt: "2026-08-07T08:00:00.000Z",
  categories: [{ id: "daily", name: "日常", isDefault: true, createdAt: "2026-08-07T08:00:00.000Z", updatedAt: "2026-08-07T08:00:00.000Z" }],
  phrases: [],
  reviewLogs: [],
};

describe("backup parsing", () => {
  it("accepts a valid version-one backup", () => {
    expect(parseBackup(JSON.stringify(valid)).version).toBe(1);
  });

  it("rejects an unsupported version", () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 2 }))).toThrow("不支持的备份版本");
  });

  it("rejects phrases referencing missing categories", () => {
    const broken = { ...valid, phrases: [{ id: "p1", english: "A", chinese: "甲", categoryId: "missing", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }] };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow("包含不存在的分类");
  });
});
