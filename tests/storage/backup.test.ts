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
    expect(parseBackup(JSON.stringify(valid))).toMatchObject({ version: 2, trainingEvents: [], trainingSessions: [] });
  });

  it("accepts and validates a version-two backup", () => {
    const v2 = {
      ...valid,
      version: 2,
      trainingEvents: [{ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 3, occurredAt: valid.exportedAt }],
      trainingSessions: [{ id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 3 }],
      phrases: [{ id: "p1", english: "A", chinese: "A", categoryId: "daily", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(v2))).toEqual(v2);
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], id: "" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], sessionId: "" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], phraseId: "" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], id: "" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], phraseId: "missing" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], activeSeconds: -1 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], currentIndex: -1 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], activeSeconds: null }] }))).toThrow();
    for (const source of ["invalid"]) expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], source }] }))).toThrow();
    for (const result of ["invalid"]) expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], result }] }))).toThrow();
    for (const field of ["usedPronunciationHint", "recorded"] as const) expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], [field]: "yes" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], occurredAt: "not-a-date" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], activeSeconds: 1.5 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], sessionId: "missing" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], mode: "invalid" }] }))).toThrow();
    for (const field of ["startedAt", "updatedAt", "completedAt"] as const) expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], [field]: "not-a-date" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], currentIndex: 0.5 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], currentIndex: 2 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], activeSeconds: 0.5 }] }))).toThrow();
  });

  it("rejects an unsupported version", () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 3 }))).toThrow();
  });

  it("rejects phrases referencing missing categories", () => {
    const broken = { ...valid, phrases: [{ id: "p1", english: "A", chinese: "甲", categoryId: "missing", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }] };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow("包含不存在的分类");
  });
});
