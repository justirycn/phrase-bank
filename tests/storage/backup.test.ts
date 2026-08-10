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
    expect(parseBackup(JSON.stringify(valid))).toMatchObject({ version: 4, trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [] });
  });

  it("accepts and validates a version-two backup", () => {
    const v2 = {
      ...valid,
      version: 2,
      trainingEvents: [{ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 3, occurredAt: valid.exportedAt }],
      trainingSessions: [{ id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 3 }],
      phrases: [{ id: "p1", english: "A", chinese: "A", categoryId: "daily", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(v2))).toMatchObject({ ...v2, version: 4, phrases: [{ ...v2.phrases[0], origin: "personal", kind: "standalone" }], phraseLearningStates: [], learningSessions: [] });
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
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 5 }))).toThrow();
  });

  it("preserves version-three learning and content state", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "system", kind: "core", subcategory: "routine", cefrLevel: "A2", intent: "state", contentVersion: "v1", qualityVersion: "q1", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const v3 = { ...valid, version: 3, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [{ phraseId: "p1", masteredDates: ["2026-08-07"], unlockedAt: valid.exportedAt, updatedAt: valid.exportedAt }], activeSystemContentVersion: "v1" };
    expect(parseBackup(JSON.stringify(v3))).toMatchObject({
      ...v3, version: 4, learningSessions: [],
      phraseLearningStates: [{
        ...v3.phraseLearningStates[0], stage: "learning", firstSeenAt: valid.exportedAt, consecutiveGood: 0,
      }],
    });
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

  it("normalizes legacy v3 state fields from real review evidence", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 3, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt, lastReviewedAt: "2026-08-09T08:00:00.000Z" };
    const v3 = {
      ...valid, version: 3, phrases: [phrase],
      reviewLogs: [{ id: "r1", phraseId: "p1", result: "good", reviewedAt: "2026-08-08T08:00:00.000Z", previousStep: 0, nextReviewAt: valid.exportedAt }],
      trainingSessions: [{ id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 1 }],
      trainingEvents: [
        { id: "e1", sessionId: "s1", phraseId: "p1", source: "new", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T08:00:00.000Z" },
        { id: "e2", sessionId: "s1", phraseId: "p1", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T08:00:00.000Z" },
      ],
      phraseLearningStates: [{ phraseId: "p1", masteredDates: ["2026-08-08"], unlockedAt: valid.exportedAt, updatedAt: "2026-08-10T08:00:00.000Z", legacyNote: "keep" }],
    };
    expect(parseBackup(JSON.stringify(v3))).toMatchObject({
      version: 4, learningSessions: [],
      phraseLearningStates: [{
        phraseId: "p1", stage: "mastered", firstSeenAt: "2026-08-08T08:00:00.000Z",
        firstTestedAt: "2026-08-08T08:00:00.000Z", firstResult: "good", consecutiveGood: 1,
        masteredDates: ["2026-08-08"], unlockedAt: valid.exportedAt, legacyNote: "keep",
      }],
    });
  });

  it("derives consecutiveGood only from training events, never review logs", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 3, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const session = { id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 1 };
    const logOnly = {
      ...valid, version: 3, phrases: [phrase], trainingSessions: [], trainingEvents: [],
      reviewLogs: [{ id: "log-only", phraseId: "p1", result: "good", reviewedAt: "2026-08-09T08:00:00.000Z", previousStep: 2, nextReviewAt: valid.exportedAt }],
      phraseLearningStates: [{ phraseId: "p1", masteredDates: [], updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(logOnly)).phraseLearningStates[0]).toMatchObject({ stage: "mastered", firstResult: "good", consecutiveGood: 0 });

    const mixed = {
      ...logOnly, trainingSessions: [session],
      trainingEvents: [{ id: "event-good", sessionId: "s1", phraseId: "p1", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T08:00:00.000Z" }],
      reviewLogs: [{ ...logOnly.reviewLogs[0], id: "later-hard-log", result: "hard", reviewedAt: "2026-08-11T08:00:00.000Z" }],
    };
    expect(parseBackup(JSON.stringify(mixed)).phraseLearningStates[0]).toMatchObject({ consecutiveGood: 1 });
  });

  it("normalizes lastReviewed-only v3 phrases to legal learning states that round-trip as v4", () => {
    const phrase = {
      id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone",
      reviewStep: 1, masteryLevel: 1, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt,
      updatedAt: "2026-08-10T08:00:00.000Z", lastReviewedAt: "2026-08-09T08:00:00.000Z",
    };
    const v3 = {
      ...valid, version: 3, phrases: [phrase], reviewLogs: [], trainingEvents: [], trainingSessions: [],
      phraseLearningStates: [{ phraseId: "p1", masteredDates: ["2026-08-08"], updatedAt: "2026-08-10T08:00:00.000Z" }],
    };
    const normalized = parseBackup(JSON.stringify(v3));
    expect(normalized.phraseLearningStates[0]).toEqual({
      phraseId: "p1", stage: "learning", firstSeenAt: phrase.lastReviewedAt, consecutiveGood: 0,
      masteredDates: ["2026-08-08"], updatedAt: "2026-08-10T08:00:00.000Z",
    });
    expect(parseBackup(JSON.stringify(normalized))).toEqual(normalized);
  });

  it("accepts and round-trips a complete v4 backup", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 1, masteryLevel: 1, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const state = { phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 1, masteredDates: ["2026-08-07"], updatedAt: valid.exportedAt };
    const session = { id: "ls1", date: "2026-08-07", themeCategoryId: "daily", phraseIds: ["p1"], studyIndex: 1, testIndex: 1, phase: "test", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, completedAt: valid.exportedAt };
    const v4 = { ...valid, version: 4, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [state], learningSessions: [session] };
    expect(parseBackup(JSON.stringify(v4))).toEqual(v4);
  });

  it("requires learningSessions in v4 and validates learning-session fields and references", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const session = { id: "ls1", date: "2026-08-07", themeCategoryId: "daily", phraseIds: ["p1"], studyIndex: 0, testIndex: 0, phase: "study", startedAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const v4 = { ...valid, version: 4, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [session] };
    expect(() => parseBackup(JSON.stringify({ ...v4, learningSessions: undefined }))).toThrow();
    for (const patch of [
      { id: "" }, { date: "not-a-day" }, { themeCategoryId: "missing" }, { phraseIds: ["missing"] },
      { phraseIds: ["p1", "p1"] }, { studyIndex: -1 }, { studyIndex: 2 }, { testIndex: 0.5 },
      { testIndex: 2 }, { phase: "quiz" }, { startedAt: "bad" }, { updatedAt: "bad" }, { completedAt: "bad" },
    ]) {
      expect(() => parseBackup(JSON.stringify({ ...v4, learningSessions: [{ ...session, ...patch }] }))).toThrow("学习会话");
    }
    expect(() => parseBackup(JSON.stringify({ ...v4, learningSessions: [session, { ...session, id: "ls2" }] }))).toThrow("多个进行中的学习会话");
  });

  it("validates new phrase-learning state fields and stage invariants", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const base = { ...valid, version: 4, phrases: [phrase], trainingEvents: [], trainingSessions: [], learningSessions: [] };
    const validStates = [
      { phraseId: "p1", stage: "unseen", consecutiveGood: 0, masteredDates: [], updatedAt: valid.exportedAt },
      { phraseId: "p1", stage: "learning", firstSeenAt: valid.exportedAt, consecutiveGood: 0, masteredDates: [], updatedAt: valid.exportedAt },
      { phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "hard", consecutiveGood: 0, masteredDates: [], updatedAt: valid.exportedAt },
      { phraseId: "p1", stage: "mastered", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 3, masteredDates: [], updatedAt: valid.exportedAt },
    ];
    for (const state of validStates) expect(parseBackup(JSON.stringify({ ...base, phraseLearningStates: [state] })).phraseLearningStates).toEqual([state]);
    const invalidStates = [
      { ...validStates[0], stage: "invalid" }, { ...validStates[0], consecutiveGood: -1 }, { ...validStates[0], consecutiveGood: 0.5 },
      { ...validStates[0], firstSeenAt: valid.exportedAt }, { ...validStates[1], firstSeenAt: "bad" }, { ...validStates[1], firstTestedAt: valid.exportedAt },
      { ...validStates[2], firstSeenAt: undefined }, { ...validStates[2], firstTestedAt: undefined }, { ...validStates[2], firstResult: undefined },
      { ...validStates[2], firstResult: "easy" }, { ...validStates[2], updatedAt: "bad" }, { ...validStates[2], unlockedAt: "bad" },
    ];
    for (const state of invalidStates) expect(() => parseBackup(JSON.stringify({ ...base, phraseLearningStates: [state] }))).toThrow("无效学习状态");
  });
});
