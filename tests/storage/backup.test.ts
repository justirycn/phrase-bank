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
    expect(parseBackup(JSON.stringify(valid))).toMatchObject({ version: 3, trainingEvents: [], trainingSessions: [], phraseLearningStates: [] });
  });

  it("accepts and validates a version-two backup", () => {
    const v2 = {
      ...valid,
      version: 2,
      trainingEvents: [{ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 3, occurredAt: valid.exportedAt }],
      trainingSessions: [{ id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 3 }],
      phrases: [{ id: "p1", english: "A", chinese: "A", categoryId: "daily", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(v2))).toMatchObject({ ...v2, version: 3, phrases: [{ ...v2.phrases[0], origin: "personal", kind: "standalone" }], phraseLearningStates: [] });
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
    expect(parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], activeSeconds: 1.5 }], trainingSessions: [{ ...v2.trainingSessions[0], activeSeconds: 2.5 }] }))).toMatchObject({
      trainingEvents: [{ activeSeconds: 1.5 }],
      trainingSessions: [{ activeSeconds: 2.5 }],
    });
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], sessionId: "missing" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], mode: "invalid" }] }))).toThrow();
    for (const field of ["startedAt", "updatedAt", "completedAt"] as const) expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], [field]: "not-a-date" }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], currentIndex: 0.5 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], currentIndex: 2 }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingEvents: [{ ...v2.trainingEvents[0], activeSeconds: "1" }] }))).toThrow();
    expect(parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], sources: ["due"] }] }))).toMatchObject({
      trainingSessions: [{ sources: ["due"] }],
    });
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], sources: [] }] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...v2, trainingSessions: [{ ...v2.trainingSessions[0], sources: ["invalid"] }] }))).toThrow();
  });

  it("rejects an unsupported version", () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 4 }))).toThrow();
  });

  it("preserves version-three learning and content state", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "system", kind: "core", subcategory: "routine", cefrLevel: "A2", intent: "state", contentVersion: "v1", qualityVersion: "q1", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const v3 = { ...valid, version: 3, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [{ phraseId: "p1", masteredDates: ["2026-08-07"], unlockedAt: valid.exportedAt, updatedAt: valid.exportedAt }], activeSystemContentVersion: "v1" };
    expect(parseBackup(JSON.stringify(v3))).toEqual(v3);
    expect(() => parseBackup(JSON.stringify({ ...v3, phraseLearningStates: [{ ...v3.phraseLearningStates[0], phraseId: "missing" }] }))).toThrow("无效学习状态");
    expect(() => parseBackup(JSON.stringify({ ...v3, phraseLearningStates: [{ ...v3.phraseLearningStates[0], masteredDates: ["2026-08-07", "2026-08-07"] }] }))).toThrow("无效学习状态");
    const orphan = { ...phrase, id: "orphan", kind: "example", parentPhraseId: "missing", unlockOrder: 1 };
    expect(() => parseBackup(JSON.stringify({ ...v3, phrases: [orphan], phraseLearningStates: [] }))).toThrow("内容层级");
    expect(() => parseBackup(JSON.stringify({ ...v3, phrases: [{ ...phrase, origin: "unknown" }] }))).toThrow("内容层级");
  });

  it("rejects phrases referencing missing categories", () => {
    const broken = { ...valid, phrases: [{ id: "p1", english: "A", chinese: "甲", categoryId: "missing", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }] };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow("包含不存在的分类");
  });
});
