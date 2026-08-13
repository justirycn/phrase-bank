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
    expect(parseBackup(JSON.stringify(valid))).toMatchObject({ version: 5, trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 } });
  });

  it("accepts and validates a version-two backup", () => {
    const v2 = {
      ...valid,
      version: 2,
      trainingEvents: [{ id: "e1", sessionId: "s1", phraseId: "p1", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 3, occurredAt: valid.exportedAt }],
      trainingSessions: [{ id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 3 }],
      phrases: [{ id: "p1", english: "A", chinese: "A", categoryId: "daily", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(v2))).toMatchObject({
      ...v2, version: 5, phrases: [{ ...v2.phrases[0], origin: "personal", kind: "standalone" }], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 },
      phraseLearningStates: [{
        phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt,
        firstResult: "good", consecutiveGood: 0, masteredDates: [], updatedAt: valid.exportedAt,
      }],
    });
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

  it("accepts version five preferences and rejects invalid or unsupported values", () => {
    const v5 = { ...valid, version: 5, trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [], appPreferences: { dailyMasteryGoal: 18 } };
    expect(parseBackup(JSON.stringify(v5))).toMatchObject({ version: 5, appPreferences: { dailyMasteryGoal: 18 } });
    expect(() => parseBackup(JSON.stringify({ ...v5, appPreferences: { dailyMasteryGoal: 0 } }))).toThrow("每日掌握目标无效");
    expect(() => parseBackup(JSON.stringify({ ...valid, version: 6 }))).toThrow();
  });

  it("preserves version-three learning and content state", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "system", kind: "core", subcategory: "routine", cefrLevel: "A2", intent: "state", contentVersion: "v1", qualityVersion: "q1", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const v3 = { ...valid, version: 3, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [{ phraseId: "p1", masteredDates: ["2026-08-07"], unlockedAt: valid.exportedAt, updatedAt: valid.exportedAt }], activeSystemContentVersion: "v1" };
    expect(parseBackup(JSON.stringify(v3))).toMatchObject({
      ...v3, version: 5, learningSessions: [], appPreferences: { dailyMasteryGoal: 10 },
      phraseLearningStates: [{
        ...v3.phraseLearningStates[0], stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 1,
      }],
    });
    expect(() => parseBackup(JSON.stringify({ ...v3, phraseLearningStates: [{ ...v3.phraseLearningStates[0], phraseId: "missing" }] }))).toThrow("无效学习状态");
    expect(parseBackup(JSON.stringify({ ...v3, phraseLearningStates: [{ ...v3.phraseLearningStates[0], masteredDates: ["2026-08-07", "2026-08-07"] }] })).phraseLearningStates[0].masteredDates).toEqual(["2026-08-07"]);
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
      version: 5, learningSessions: [], appPreferences: { dailyMasteryGoal: 10 },
      phraseLearningStates: [{
        phraseId: "p1", stage: "learned", firstSeenAt: "2026-08-08T08:00:00.000Z",
        firstTestedAt: "2026-08-08T08:00:00.000Z", firstResult: "good", consecutiveGood: 1,
        masteredDates: ["2026-08-08"], unlockedAt: valid.exportedAt, legacyNote: "keep",
      }],
    });
  });

  it("derives legacy mastery progress from persisted Shanghai dates, never old counters", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 3, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const session = { id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 1 };
    const logOnly = {
      ...valid, version: 3, phrases: [phrase], trainingSessions: [], trainingEvents: [],
      reviewLogs: [{ id: "log-only", phraseId: "p1", result: "good", reviewedAt: "2026-08-09T08:00:00.000Z", previousStep: 2, nextReviewAt: valid.exportedAt }],
      phraseLearningStates: [{ phraseId: "p1", masteredDates: [], updatedAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(logOnly)).phraseLearningStates[0]).toMatchObject({ stage: "learned", firstResult: "good", consecutiveGood: 0 });

    const mixed = {
      ...logOnly, trainingSessions: [session],
      trainingEvents: [{ id: "event-good", sessionId: "s1", phraseId: "p1", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T08:00:00.000Z" }],
      reviewLogs: [{ ...logOnly.reviewLogs[0], id: "later-hard-log", result: "hard", reviewedAt: "2026-08-11T08:00:00.000Z" }],
    };
    expect(parseBackup(JSON.stringify(mixed)).phraseLearningStates[0]).toMatchObject({ consecutiveGood: 0 });
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
      phraseId: "p1", stage: "learned", firstSeenAt: phrase.lastReviewedAt, firstTestedAt: phrase.lastReviewedAt, firstResult: "good", consecutiveGood: 1,
      masteredDates: ["2026-08-08"], updatedAt: "2026-08-10T08:00:00.000Z",
    });
    expect(parseBackup(JSON.stringify(normalized))).toEqual(normalized);
  });

  it("migrates a complete v4 backup and round-trips it as v5", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 1, masteryLevel: 1, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const state = { phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 1, masteredDates: ["2026-08-07"], updatedAt: valid.exportedAt };
    const session = { id: "ls1", date: "2026-08-07", themeCategoryId: "daily", phraseIds: ["p1"], studyIndex: 1, testIndex: 1, phase: "test", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, completedAt: valid.exportedAt };
    const v4 = { ...valid, version: 4, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [state], learningSessions: [session] };
    const migrated = { ...v4, version: 5, appPreferences: { dailyMasteryGoal: 10 } };
    expect(parseBackup(JSON.stringify(v4))).toEqual(migrated);
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
  });

  it("normalizes current backup mastery from effective dates without a version bump", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 3, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const base = { ...valid, version: 5, phrases: [phrase], trainingEvents: [], trainingSessions: [], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 } };
    const metadata = { firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", updatedAt: valid.exportedAt };
    const falseMastered = { phraseId: "p1", stage: "mastered", consecutiveGood: 3, masteredDates: ["2026-08-07"], ...metadata };
    const falseLearned = { phraseId: "p1", stage: "learned", consecutiveGood: 0, masteredDates: ["2026-08-07", "2026-08-08", "2026-08-09"], ...metadata };

    expect(parseBackup(JSON.stringify({ ...base, phraseLearningStates: [falseMastered] }))).toMatchObject({
      version: 5, phraseLearningStates: [{ stage: "learned", consecutiveGood: 1 }],
    });
    expect(parseBackup(JSON.stringify({ ...base, phraseLearningStates: [falseLearned] }))).toMatchObject({
      version: 5, phraseLearningStates: [{ stage: "mastered", consecutiveGood: 3 }],
    });
  });

  it("cleans duplicate and malformed mastery dates in v3, v4, and v5 backups", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 3, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt, lastReviewedAt: valid.exportedAt };
    const dirtyDates = ["2026-08-09", "bad", "2026-08-07", "2026-08-09", "2026-02-30", "2026-08-08"];
    const currentState = { phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 0, masteredDates: dirtyDates, updatedAt: valid.exportedAt };
    const common = { ...valid, phrases: [phrase], trainingEvents: [], trainingSessions: [] };

    const v3 = parseBackup(JSON.stringify({ ...common, version: 3, phraseLearningStates: [{ phraseId: "p1", masteredDates: dirtyDates, updatedAt: valid.exportedAt }] }));
    expect(v3.phraseLearningStates[0]).toMatchObject({
      masteredDates: ["2026-08-07", "2026-08-08", "2026-08-09"], stage: "mastered", consecutiveGood: 3,
    });
    for (const backup of [
      { ...common, version: 4, phraseLearningStates: [currentState], learningSessions: [] },
      { ...common, version: 5, phraseLearningStates: [currentState], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 } },
    ]) {
      expect(parseBackup(JSON.stringify(backup)).phraseLearningStates[0]).toMatchObject({
        masteredDates: ["2026-08-07", "2026-08-08", "2026-08-09"], stage: "mastered", consecutiveGood: 3,
      });
    }
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
      { phraseId: "p1", stage: "mastered", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt, firstResult: "good", consecutiveGood: 3, masteredDates: ["2026-08-07", "2026-08-08", "2026-08-09"], updatedAt: valid.exportedAt },
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

  it("round-trips an optional mastery reset timestamp without changing the backup version", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const state = {
      phraseId: "p1", stage: "learned", firstSeenAt: valid.exportedAt, firstTestedAt: valid.exportedAt,
      firstResult: "good", consecutiveGood: 0, masteredDates: ["2026-08-07"],
      masteryResetAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z",
    };
    const v5 = { ...valid, version: 5, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [state], learningSessions: [], appPreferences: { dailyMasteryGoal: 10 } };
    expect(parseBackup(JSON.stringify(v5))).toMatchObject({ version: 5, phraseLearningStates: [state] });
    expect(() => parseBackup(JSON.stringify({ ...v5, phraseLearningStates: [{ ...state, masteryResetAt: "not-a-date" }] }))).toThrow();

    const legacyCompatibleState = Object.fromEntries(Object.entries(state).filter(([key]) => key !== "masteryResetAt"));
    expect(parseBackup(JSON.stringify({ ...v5, phraseLearningStates: [legacyCompatibleState] }))).toMatchObject({
      version: 5, phraseLearningStates: [{ ...legacyCompatibleState, consecutiveGood: 1 }],
    });
  });

  it("normalizes legacy mastery using only three effective dates after its reset", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 4, masteryLevel: 3, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: "2026-08-12T08:00:00.000Z", lastReviewedAt: "2026-08-12T08:00:00.000Z" };
    const state = {
      phraseId: "p1", masteredDates: ["2026-08-07", "2026-08-08", "2026-08-12"],
      masteryResetAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z",
    };
    const v3 = {
      ...valid, version: 3, phrases: [phrase], trainingEvents: [], trainingSessions: [],
      reviewLogs: [{ id: "review", phraseId: "p1", result: "good", reviewedAt: phrase.lastReviewedAt, previousStep: 3, nextReviewAt: phrase.nextReviewAt }],
      phraseLearningStates: [state],
    };

    expect(parseBackup(JSON.stringify(v3)).phraseLearningStates[0]).toMatchObject({
      stage: "learned", consecutiveGood: 1, masteryResetAt: state.masteryResetAt,
    });
  });

  it("normalizes v1 review logs and v2 training events into legal learning states", () => {
    const phrase = (id: string, masteryLevel: number) => ({
      id, english: id, chinese: id, categoryId: "daily", reviewStep: masteryLevel, masteryLevel,
      nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt,
    });
    const v1 = {
      ...valid, phrases: [phrase("v1-phrase", 1)],
      reviewLogs: [{ id: "v1-log", phraseId: "v1-phrase", result: "hard", reviewedAt: "2026-08-08T08:00:00.000Z", previousStep: 0, nextReviewAt: valid.exportedAt }],
    };
    expect(parseBackup(JSON.stringify(v1)).phraseLearningStates).toEqual([{
      phraseId: "v1-phrase", stage: "learned", firstSeenAt: "2026-08-08T08:00:00.000Z",
      firstTestedAt: "2026-08-08T08:00:00.000Z", firstResult: "hard", consecutiveGood: 0,
      masteredDates: [], updatedAt: valid.exportedAt,
    }]);

    const v2 = {
      ...valid, version: 2, phrases: [phrase("v2-phrase", 3)], reviewLogs: [],
      trainingSessions: [{ id: "v2-session", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["v2-phrase"], currentIndex: 0, activeSeconds: 2 }],
      trainingEvents: [
        { id: "v2-1", sessionId: "v2-session", phraseId: "v2-phrase", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-08T08:00:00.000Z" },
        { id: "v2-2", sessionId: "v2-session", phraseId: "v2-phrase", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T08:00:00.000Z" },
      ],
    };
    expect(parseBackup(JSON.stringify(v2)).phraseLearningStates).toEqual([{
      phraseId: "v2-phrase", stage: "learned", firstSeenAt: "2026-08-08T08:00:00.000Z",
      firstTestedAt: "2026-08-08T08:00:00.000Z", firstResult: "good", consecutiveGood: 0,
      masteredDates: [], updatedAt: valid.exportedAt,
    }]);
  });

  it("sorts same-timestamp evidence deterministically by source and id", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", reviewStep: 1, masteryLevel: 1, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const session = { id: "s1", mode: "quick", startedAt: valid.exportedAt, updatedAt: valid.exportedAt, phraseIds: ["p1"], currentIndex: 0, activeSeconds: 1 };
    const timestamp = "2026-08-09T08:00:00.000Z";
    const events = [
      { id: "z-again", sessionId: "s1", phraseId: "p1", source: "new", result: "again", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: timestamp },
      { id: "a-good", sessionId: "s1", phraseId: "p1", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: timestamp },
    ];
    const logs = [{ id: "a-log-hard", phraseId: "p1", result: "hard", reviewedAt: timestamp, previousStep: 0, nextReviewAt: valid.exportedAt }];
    const backup = { ...valid, version: 3, phrases: [phrase], reviewLogs: logs, trainingSessions: [session], trainingEvents: events, phraseLearningStates: [] };
    const forward = parseBackup(JSON.stringify(backup)).phraseLearningStates[0];
    const reversed = parseBackup(JSON.stringify({ ...backup, reviewLogs: [...logs].reverse(), trainingEvents: [...events].reverse() })).phraseLearningStates[0];
    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({ firstResult: "good", consecutiveGood: 0 });
  });

  it("validates v4 learning-session lifecycle semantics", () => {
    const phrase = { id: "p1", english: "A", chinese: "A", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const session = { id: "ls1", date: "2026-08-07", themeCategoryId: "daily", phraseIds: ["p1"], studyIndex: 0, testIndex: 0, phase: "study", startedAt: valid.exportedAt, updatedAt: valid.exportedAt };
    const base = { ...valid, version: 4, phrases: [phrase], trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [session] };
    for (const validSession of [
      session,
      { ...session, phase: "test", studyIndex: 1, testIndex: 0 },
      { ...session, phase: "test", studyIndex: 1, testIndex: 1 },
      { ...session, phase: "test", studyIndex: 1, testIndex: 1, completedAt: valid.exportedAt },
    ]) expect(() => parseBackup(JSON.stringify({ ...base, learningSessions: [validSession] }))).not.toThrow();
    for (const invalidSession of [
      { ...session, phraseIds: [] }, { ...session, studyIndex: 1 }, { ...session, testIndex: 1 },
      { ...session, completedAt: valid.exportedAt }, { ...session, phase: "test", studyIndex: 0 },
      { ...session, phase: "test", studyIndex: 1, testIndex: 0, completedAt: valid.exportedAt },
    ]) expect(() => parseBackup(JSON.stringify({ ...base, learningSessions: [invalidSession] }))).toThrow("学习会话");
  });

  it("rejects personal standalone phrases that carry hierarchy fields", () => {
    const phrase = { id: "p1", english: "A", chinese: "甲", categoryId: "daily", origin: "personal", kind: "standalone", reviewStep: 0, masteryLevel: 0, nextReviewAt: valid.exportedAt, createdAt: valid.exportedAt, updatedAt: valid.exportedAt };
    for (const hierarchy of [{ parentPhraseId: "anything" }, { unlockOrder: 1 }]) {
      expect(() => parseBackup(JSON.stringify({ ...valid, phrases: [{ ...phrase, ...hierarchy }] }))).toThrow("内容层级");
    }
  });
});
