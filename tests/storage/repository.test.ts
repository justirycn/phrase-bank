import { beforeEach, describe, expect, it } from "vitest";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";
import { createNewPhrase } from "../../app/domain/review";
import type { BackupEnvelopeV1, BackupEnvelopeV2, Category, LearningSessionRecord, Phrase, PhraseLearningState, ReviewLog, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";
import { parseBackup } from "../../app/storage/backup";

describe("LocalPhraseRepository", () => {
  let repo: LocalPhraseRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    repo = new LocalPhraseRepository(`phrase-bank-${crypto.randomUUID()}`);
    await repo.initialize();
  });

  const contentPackage = (version: string, english = "System core"): SystemContentPackage => ({
    format: "phrase-bank-system-content", version, generatedAt: "2026-08-10T00:00:00.000Z", qualityVersion: "q1",
    phrases: [
      { id: "sys-core", english, chinese: "系统核心句", categoryId: "daily", origin: "system", kind: "core", subcategory: "routine", cefrLevel: "A2", intent: "state", contentVersion: version, qualityVersion: "q1" },
      { id: "sys-example", english: "System example", chinese: "系统案例句", categoryId: "daily", origin: "system", kind: "example", parentPhraseId: "sys-core", unlockOrder: 1, subcategory: "routine", cefrLevel: "A2", intent: "state", contentVersion: version, qualityVersion: "q1" },
    ],
  });

  const learningSession = (overrides: Partial<LearningSessionRecord> = {}): LearningSessionRecord => ({
    id: "learning-session", date: "2026-08-10", themeCategoryId: "daily",
    phraseIds: ["starter-daily-not-sure"], studyIndex: 1, testIndex: 0, phase: "test",
    startedAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z",
    ...overrides,
  });

  it("installs, updates, retires, and rolls back validated system packages", async () => {
    await repo.installSystemContentPackage(contentPackage("v1"));
    expect(await repo.getActiveSystemContentVersion()).toBe("v1");
    expect(await repo.getPhrase("sys-core")).toMatchObject({ english: "System core", origin: "system", kind: "core" });
    expect(await repo.listPhraseLearningStates()).toContainEqual(expect.objectContaining({ phraseId: "sys-core", masteredDates: [] }));

    const v2 = contentPackage("v2", "Updated system core");
    v2.phrases = v2.phrases.slice(0, 1);
    await repo.installSystemContentPackage(v2);
    await repo.installSystemContentPackage(v2);
    expect(await repo.getPhrase("sys-core")).toMatchObject({ english: "Updated system core", contentVersion: "v2" });
    expect((await repo.getPhrase("sys-example"))?.retiredAt).toBeDefined();

    await repo.rollbackSystemContentPackage("v1");
    expect(await repo.getActiveSystemContentVersion()).toBe("v1");
    expect(await repo.getPhrase("sys-core")).toMatchObject({ english: "System core", contentVersion: "v1" });
    expect((await repo.getPhrase("sys-example"))?.retiredAt).toBeUndefined();
  });

  it("rejects a system package that collides with personal content without partial writes", async () => {
    await repo.savePhrase({ ...createNewPhrase({ english: "Mine", chinese: "我的", categoryId: "daily" }), id: "sys-core" });
    await expect(repo.installSystemContentPackage(contentPackage("v1"))).rejects.toThrow("个人句子");
    expect(await repo.getActiveSystemContentVersion()).toBeUndefined();
    expect(await repo.getPhrase("sys-core")).toMatchObject({ english: "Mine", origin: "personal" });
    expect(await repo.getPhrase("sys-example")).toBeUndefined();
  });

  it("atomically records mastery dates and unlocks one example at a time", async () => {
    await repo.installSystemContentPackage(contentPackage("v1"));
    const event = (id: string, phraseId: string, occurredAt: string): TrainingEvent => ({ id, sessionId: "s", phraseId, source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt });
    await repo.submitTrainingReview(event("core-1", "sys-core", "2026-08-09T08:00:00.000Z"));
    await repo.submitTrainingReview(event("core-same", "sys-core", "2026-08-09T12:00:00.000Z"));
    expect((await repo.listPhraseLearningStates()).find(({ phraseId }) => phraseId === "sys-core")?.masteredDates).toEqual(["2026-08-09"]);
    expect((await repo.listPhraseLearningStates()).find(({ phraseId }) => phraseId === "sys-example")?.unlockedAt).toBeUndefined();
    await repo.submitTrainingReview(event("core-2", "sys-core", "2026-08-10T08:00:00.000Z"));
    expect((await repo.listPhraseLearningStates()).find(({ phraseId }) => phraseId === "sys-example")?.unlockedAt).toBe("2026-08-10T08:00:00.000Z");
  });

  it("round-trips system version and learning state through a v3 backup", async () => {
    await repo.installSystemContentPackage(contentPackage("v1"));
    await repo.submitTrainingReview({ id: "mastery", sessionId: "s", phraseId: "sys-core", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T08:00:00.000Z" });
    const snapshot = await repo.exportSnapshot();
    const restored = new LocalPhraseRepository(`restored-${crypto.randomUUID()}`);
    await restored.initialize();
    await restored.importSnapshot(snapshot, "overwrite");
    expect(await restored.getActiveSystemContentVersion()).toBe("v1");
    expect(await restored.getPhrase("sys-core")).toMatchObject({ origin: "system", contentVersion: "v1" });
    expect(await restored.listPhraseLearningStates()).toContainEqual(expect.objectContaining({ phraseId: "sys-core", masteredDates: ["2026-08-09"] }));
    await restored.importSnapshot({ ...snapshot, phraseLearningStates: snapshot.phraseLearningStates.map((state) => state.phraseId === "sys-core" ? { ...state, masteredDates: ["2026-08-10"] } : state) }, "skip");
    expect((await restored.listPhraseLearningStates()).find(({ phraseId }) => phraseId === "sys-core")?.masteredDates).toEqual(["2026-08-09"]);
  });

  it("seeds the nine default categories once", async () => {
    expect(await repo.listCategories()).toHaveLength(9);
    expect(await repo.listPhrases()).toHaveLength(40);
    await repo.initialize();
    expect(await repo.listCategories()).toHaveLength(9);
    expect(await repo.listPhrases()).toHaveLength(40);
  });

  it("does not restore a starter phrase deleted after initialization", async () => {
    await repo.deletePhrase("starter-daily-not-sure");
    await repo.initialize();
    expect(await repo.getPhrase("starter-daily-not-sure")).toBeUndefined();
    expect(await repo.getPhraseLearningState("starter-daily-not-sure")).toBeUndefined();
    expect(await repo.listPhrases()).toHaveLength(39);
    const snapshot = await repo.exportSnapshot();
    expect(() => parseBackup(JSON.stringify(snapshot))).not.toThrow();
  });

  it("does not overwrite an existing phrase with a starter id", async () => {
    globalThis.indexedDB = new IDBFactory();
    const customRepo = new LocalPhraseRepository(`phrase-bank-${crypto.randomUUID()}`);
    const custom = { ...createNewPhrase({ english: "My custom version", chinese: "我的版本", categoryId: "daily" }), id: "starter-daily-not-sure", reviewStep: 3, masteryLevel: 3 };
    await customRepo.savePhrase(custom);
    await customRepo.initialize();
    expect(await customRepo.getPhrase(custom.id)).toMatchObject({ english: "My custom version", reviewStep: 3, masteryLevel: 3 });
    expect(await customRepo.listPhrases()).toHaveLength(40);
  });

  it("saves, lists, updates and deletes a phrase", async () => {
    const phrase = createNewPhrase({ english: "I'm ready.", chinese: "我准备好了。", categoryId: "daily" });
    await repo.savePhrase(phrase);
    expect((await repo.listPhrases()).map((item) => item.english)).toContain("I'm ready.");
    await repo.savePhrase({ ...phrase, chinese: "我已经准备好了。" });
    expect((await repo.getPhrase(phrase.id))?.chinese).toBe("我已经准备好了。");
    await repo.deletePhrase(phrase.id);
    expect(await repo.getPhrase(phrase.id)).toBeUndefined();
  });

  it("returns only phrases due by the requested time", async () => {
    const now = new Date("2026-08-07T08:00:00.000Z");
    const due = createNewPhrase({ english: "Due", chinese: "到期", categoryId: "daily" }, now);
    const future = { ...createNewPhrase({ english: "Future", chinese: "未来", categoryId: "daily" }, now), id: "future", nextReviewAt: "2026-08-09T08:00:00.000Z" };
    await repo.savePhrase(due); await repo.savePhrase(future);
    expect((await repo.listDuePhrases(now)).map((item) => item.english)).toEqual(["Due"]);
  });

  it("submits a review atomically", async () => {
    const now = new Date("2026-08-07T08:00:00.000Z");
    const phrase = createNewPhrase({ english: "Review", chinese: "复习", categoryId: "daily" }, now);
    await repo.savePhrase(phrase);
    await repo.submitReview(phrase.id, "good", now);
    expect((await repo.getPhrase(phrase.id))?.reviewStep).toBe(1);
    expect((await repo.exportSnapshot()).reviewLogs).toHaveLength(1);
    expect(await repo.getPhraseLearningState(phrase.id)).toMatchObject({
      stage: "learned", firstSeenAt: now.toISOString(), firstTestedAt: now.toISOString(),
      firstResult: "good", consecutiveGood: 1,
    });
  });

  it("deduplicates events and lists inclusive time ranges in chronological order", async () => {
    const event = (id: string, occurredAt: string): TrainingEvent => ({ id, sessionId: "s1", phraseId: "starter-daily-not-sure", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 2, occurredAt });
    await repo.saveTrainingEvent(event("late", "2026-08-07T10:00:00.000Z"));
    await repo.saveTrainingEvent(event("early", "2026-08-07T08:00:00.000Z"));
    await repo.saveTrainingEvent(event("middle", "2026-08-07T09:00:00.000Z"));
    await repo.saveTrainingEvent(event("late", "2026-08-07T10:00:00.000Z"));
    expect((await repo.listTrainingEvents()).map(({ id }) => id)).toEqual(["early", "middle", "late"]);
    expect((await repo.listTrainingEvents(new Date("2026-08-07T09:00:00.000Z"))).map(({ id }) => id)).toEqual(["middle", "late"]);
    expect((await repo.listTrainingEvents(undefined, new Date("2026-08-07T09:00:00.000Z"))).map(({ id }) => id)).toEqual(["early", "middle"]);
    expect((await repo.listTrainingEvents(new Date("2026-08-07T08:00:00.000Z"), new Date("2026-08-07T09:00:00.000Z"))).map(({ id }) => id)).toEqual(["early", "middle"]);
    expect((await repo.listTrainingEvents(new Date("2026-08-07T08:00:00.000Z"), new Date("2026-08-07T08:00:00.000Z"))).map(({ id }) => id)).toEqual(["early"]);
  });

  it("atomically applies a training event and review only once", async () => {
    const occurredAt = "2026-08-07T08:00:00.000Z";
    const phrase = createNewPhrase({ english: "Atomic", chinese: "Atomic", categoryId: "daily" }, new Date(occurredAt));
    await repo.savePhrase(phrase);
    const event: TrainingEvent = {
      id: "atomic-event", sessionId: "atomic-session", phraseId: phrase.id, source: "due",
      result: "good", usedPronunciationHint: false, recorded: true, activeSeconds: 4, occurredAt,
    };
    await repo.submitTrainingReview(event);
    await repo.submitTrainingReview(event);
    expect(await repo.listTrainingEvents()).toContainEqual(event);
    expect((await repo.listTrainingEvents()).filter((item) => item.id === event.id)).toHaveLength(1);
    expect((await repo.getPhrase(phrase.id))?.reviewStep).toBe(1);
    expect((await repo.exportSnapshot()).reviewLogs.filter((log) => log.phraseId === phrase.id)).toHaveLength(1);
    expect(await repo.getPhraseLearningState(phrase.id)).toMatchObject({
      stage: "learned", firstResult: "good", consecutiveGood: 1,
    });
  });

  it("does not store a training event when its atomic review cannot be applied", async () => {
    const before = await repo.exportSnapshot();
    const event: TrainingEvent = {
      id: "failed-atomic-event", sessionId: "atomic-session", phraseId: "missing", source: "due",
      result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1,
      occurredAt: "2026-08-07T08:00:00.000Z",
    };
    await expect(repo.submitTrainingReview(event)).rejects.toThrow();
    const after = await repo.exportSnapshot();
    expect(after.trainingEvents).toEqual(before.trainingEvents);
    expect(after.reviewLogs).toEqual(before.reviewLogs);
    expect(after.phrases).toEqual(before.phrases);
  });

  it("returns the newest incomplete session and completes sessions", async () => {
    const session = (id: string, updatedAt: string, completedAt?: string): TrainingSessionRecord => ({ id, mode: "quick", startedAt: updatedAt, updatedAt, completedAt, phraseIds: [], currentIndex: 0, activeSeconds: 0 });
    await repo.saveTrainingSession(session("older", "2026-08-07T08:00:00.000Z"));
    await repo.saveTrainingSession(session("completed-newest", "2026-08-07T10:00:00.000Z", "2026-08-07T10:00:00.000Z"));
    await repo.saveTrainingSession(session("newest-active", "2026-08-07T09:00:00.000Z"));
    expect((await repo.getActiveTrainingSession())?.id).toBe("newest-active");
    await repo.saveTrainingSession({ ...session("newest-active", "2026-08-07T10:30:00.000Z"), currentIndex: 2, activeSeconds: 17, phraseIds: ["p1", "p2", "p3"] });
    const completedAt = new Date("2026-08-07T11:00:00.000Z");
    await repo.completeTrainingSession("newest-active", completedAt);
    expect((await repo.exportSnapshot()).trainingSessions.find(({ id }) => id === "newest-active")).toMatchObject({ completedAt: completedAt.toISOString(), updatedAt: completedAt.toISOString(), currentIndex: 2, activeSeconds: 17, phraseIds: ["p1", "p2", "p3"] });
    await expect(repo.completeTrainingSession("missing", completedAt)).rejects.toThrow();
  });

  it("persists speech preferences and falls back for corrupt metadata", async () => {
    expect(await repo.getSpeechPreferences()).toEqual({ accent: "en-US", autoSpeak: true });
    await repo.saveSpeechPreferences({ accent: "en-GB", autoSpeak: false });
    expect(await repo.getSpeechPreferences()).toEqual({ accent: "en-GB", autoSpeak: false });
    const persistedName = `phrase-bank-preferences-${crypto.randomUUID()}`;
    const persistedRepo = new LocalPhraseRepository(persistedName);
    await persistedRepo.saveSpeechPreferences({ accent: "en-GB", autoSpeak: false });
    expect(await new LocalPhraseRepository(persistedName).getSpeechPreferences()).toEqual({ accent: "en-GB", autoSpeak: false });
    const snapshot = await repo.exportSnapshot();
    expect(snapshot.version).toBe(4);
    const dbName = `phrase-bank-${crypto.randomUUID()}`;
    const corruptRepo = new LocalPhraseRepository(dbName);
    await corruptRepo.initialize();
    const request = indexedDB.open(dbName, 4);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction("metadata", "readwrite");
    tx.objectStore("metadata").put({ key: "speechPreferences", value: "{" });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    expect(await corruptRepo.getSpeechPreferences()).toEqual({ accent: "en-US", autoSpeak: true });
    for (const value of [JSON.stringify({ accent: "fr-FR", autoSpeak: true }), JSON.stringify({ accent: "en-US", autoSpeak: "yes" })]) {
      const invalidTx = db.transaction("metadata", "readwrite");
      invalidTx.objectStore("metadata").put({ key: "speechPreferences", value });
      await new Promise<void>((resolve, reject) => { invalidTx.oncomplete = () => resolve(); invalidTx.onerror = () => reject(invalidTx.error); });
      expect(await corruptRepo.getSpeechPreferences()).toEqual({ accent: "en-US", autoSpeak: true });
    }
  });

  it("exports v2 and imports v1/v2 training data with skip and overwrite policies", async () => {
    const base = await repo.exportSnapshot();
    expect(base).toMatchObject({ version: 4, trainingEvents: [], trainingSessions: [], learningSessions: [] });
    const v1: BackupEnvelopeV1 = { format: base.format, version: 1, exportedAt: base.exportedAt, categories: [], phrases: [], reviewLogs: [] };
    const event: TrainingEvent = { id: "event", sessionId: "session", phraseId: "starter-daily-not-sure", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: base.exportedAt };
    const session: TrainingSessionRecord = { id: "session", mode: "quick", startedAt: base.exportedAt, updatedAt: base.exportedAt, phraseIds: [event.phraseId], sources: ["due"], currentIndex: 0, activeSeconds: 1 };
    await repo.saveTrainingEvent(event);
    await repo.saveTrainingSession(session);
    const normalizedV1 = parseBackup(JSON.stringify(v1));
    expect(normalizedV1).toMatchObject({ version: 4, trainingEvents: [], trainingSessions: [], phraseLearningStates: [], learningSessions: [] });
    await repo.importSnapshot(normalizedV1, "overwrite");
    expect((await repo.exportSnapshot()).trainingEvents).toEqual([event]);
    expect((await repo.exportSnapshot()).trainingSessions).toEqual([session]);
    const v2: BackupEnvelopeV2 = { format: base.format, version: 2, exportedAt: base.exportedAt, categories: base.categories, phrases: base.phrases, reviewLogs: base.reviewLogs, trainingEvents: [event], trainingSessions: [session] };
    await repo.importSnapshot(v2, "overwrite");
    await repo.importSnapshot({ ...v2, trainingEvents: [{ ...event, activeSeconds: 9 }], trainingSessions: [{ ...session, activeSeconds: 9 }] }, "skip");
    expect((await repo.listTrainingEvents())[0].activeSeconds).toBe(1);
    expect((await repo.exportSnapshot()).trainingSessions[0].activeSeconds).toBe(1);
    await repo.importSnapshot({ ...v2, trainingEvents: [{ ...event, activeSeconds: 9 }], trainingSessions: [{ ...session, activeSeconds: 9 }] }, "overwrite");
    expect((await repo.listTrainingEvents())[0].activeSeconds).toBe(9);
    expect((await repo.exportSnapshot()).trainingSessions[0].activeSeconds).toBe(9);
  });

  it("exports related phrase, session, and event in one snapshot", async () => {
    const phrase = createNewPhrase({ english: "Coherent", chinese: "Coherent", categoryId: "daily" });
    const session: TrainingSessionRecord = { id: "coherent-session", mode: "quick", startedAt: phrase.createdAt, updatedAt: phrase.updatedAt, phraseIds: [phrase.id], currentIndex: 0, activeSeconds: 1 };
    const event: TrainingEvent = { id: "coherent-event", sessionId: session.id, phraseId: phrase.id, source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: phrase.createdAt };
    await repo.savePhrase(phrase); await repo.saveTrainingSession(session); await repo.saveTrainingEvent(event);
    const snapshot = await repo.exportSnapshot();
    expect(snapshot.phrases).toContainEqual(phrase);
    expect(snapshot.trainingSessions).toContainEqual(session);
    expect(snapshot.trainingEvents).toContainEqual(event);
  });

  it("migrates a manually-created v1 database without losing records", async () => {
    globalThis.indexedDB = new IDBFactory();
    const dbName = `phrase-bank-v1-${crypto.randomUUID()}`;
    const timestamp = "2026-08-07T08:00:00.000Z";
    const category: Category = { id: "custom", name: "Custom", isDefault: false, createdAt: timestamp, updatedAt: timestamp };
    const phrase: Phrase = { id: "custom-phrase", english: "Hello", chinese: "Hello", categoryId: category.id, reviewStep: 0, masteryLevel: 0, nextReviewAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
    const log: ReviewLog = { id: "custom-log", phraseId: phrase.id, result: "good", reviewedAt: timestamp, previousStep: 0, nextReviewAt: timestamp };
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => { const db = request.result; const phrases = db.createObjectStore("phrases", { keyPath: "id" }); phrases.createIndex("by-due", "nextReviewAt"); phrases.createIndex("by-created", "createdAt"); phrases.createIndex("by-category", "categoryId"); db.createObjectStore("categories", { keyPath: "id" }); const logs = db.createObjectStore("reviewLogs", { keyPath: "id" }); logs.createIndex("by-phrase", "phraseId"); db.createObjectStore("metadata", { keyPath: "key" }); };
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = oldDb.transaction(["phrases", "categories", "reviewLogs", "metadata"], "readwrite");
    const originalMetadata = [{ key: "initialized", value: "custom-value" }, { key: "starterPhrasesVersion", value: "1" }, { key: "customMetadata", value: "preserve-me" }];
    tx.objectStore("categories").put(category); tx.objectStore("phrases").put(phrase); tx.objectStore("reviewLogs").put(log); for (const entry of originalMetadata) tx.objectStore("metadata").put(entry);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); oldDb.close();
    const migrated = new LocalPhraseRepository(dbName); await migrated.initialize();
    expect(await migrated.getPhrase(phrase.id)).toEqual({ ...phrase, origin: "personal", kind: "standalone" });
    expect(await migrated.listCategories()).toContainEqual(category);
    expect((await migrated.exportSnapshot()).reviewLogs).toContainEqual(log);
    const reopened = indexedDB.open(dbName, 4);
    const upgradedDb = await new Promise<IDBDatabase>((resolve, reject) => { reopened.onsuccess = () => resolve(reopened.result); reopened.onerror = () => reject(reopened.error); });
    const metadata = await new Promise<Array<{ key: string; value: string }>>((resolve, reject) => { const read = upgradedDb.transaction("metadata").objectStore("metadata").getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
    expect(metadata).toEqual([...originalMetadata].sort((a, b) => a.key.localeCompare(b.key)));
    expect(upgradedDb.objectStoreNames.contains("trainingEvents")).toBe(true);
    expect(upgradedDb.objectStoreNames.contains("trainingSessions")).toBe(true);
    expect(upgradedDb.objectStoreNames.contains("phraseLearningState")).toBe(true);
    expect(upgradedDb.objectStoreNames.contains("systemContentPackages")).toBe(true);
    expect(upgradedDb.objectStoreNames.contains("learningSessions")).toBe(true);
    const schemaTx = upgradedDb.transaction(["trainingEvents", "trainingSessions", "learningSessions"]);
    expect(Array.from(schemaTx.objectStore("trainingEvents").indexNames)).toEqual(expect.arrayContaining(["by-occurred", "by-session", "by-phrase"]));
    expect(Array.from(schemaTx.objectStore("trainingSessions").indexNames)).toContain("by-updated");
    expect(Array.from(schemaTx.objectStore("learningSessions").indexNames)).toContain("by-updated");
    await migrated.saveTrainingSession({ id: "new-session", mode: "quick", startedAt: timestamp, updatedAt: timestamp, phraseIds: [phrase.id], currentIndex: 0, activeSeconds: 0 });
    expect((await migrated.getActiveTrainingSession())?.id).toBe("new-session");
    await migrated.saveTrainingEvent({ id: "new-event", sessionId: "new-session", phraseId: phrase.id, source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: timestamp });
    expect((await migrated.listTrainingEvents()).map(({ id }) => id)).toContain("new-event");
    await migrated.saveSpeechPreferences({ accent: "en-GB", autoSpeak: false });
    expect(await migrated.getSpeechPreferences()).toEqual({ accent: "en-GB", autoSpeak: false });
  });

  it("persists legal phrase states and learning-session CRUD in updated order", async () => {
    const state: PhraseLearningState = {
      phraseId: "starter-daily-not-sure", stage: "learning",
      firstSeenAt: "2026-08-10T08:00:00.000Z", consecutiveGood: 0,
      masteredDates: [], updatedAt: "2026-08-10T08:00:00.000Z",
    };
    await repo.savePhraseLearningState(state);
    expect(await repo.getPhraseLearningState(state.phraseId)).toEqual(state);

    await repo.saveLearningSession(learningSession({ id: "older", testIndex: 1, completedAt: "2026-08-10T08:00:00.000Z" }));
    await repo.saveLearningSession(learningSession({ id: "completed-newer", testIndex: 1, updatedAt: "2026-08-10T10:00:00.000Z", completedAt: "2026-08-10T10:00:00.000Z" }));
    await repo.saveLearningSession(learningSession({ id: "newest", testIndex: 1, updatedAt: "2026-08-10T09:00:00.000Z" }));
    expect((await repo.getActiveLearningSession())?.id).toBe("newest");

    const completedAt = new Date("2026-08-10T11:00:00.000Z");
    await repo.completeLearningSession("newest", completedAt);
    expect((await repo.exportSnapshot()).learningSessions.find(({ id }) => id === "newest")).toEqual({
      ...learningSession({ id: "newest", testIndex: 1, updatedAt: completedAt.toISOString() }),
      completedAt: completedAt.toISOString(),
    });
    await expect(repo.completeLearningSession("missing", completedAt)).rejects.toThrow("找不到学习会话");
  });

  it("creates legal unseen states for seeded and installed phrases", async () => {
    expect(await repo.getPhraseLearningState("starter-daily-not-sure")).toMatchObject({ stage: "unseen", consecutiveGood: 0, masteredDates: [] });
    await repo.installSystemContentPackage(contentPackage("v1"));
    expect(await repo.getPhraseLearningState("sys-core")).toMatchObject({ stage: "unseen", consecutiveGood: 0, unlockedAt: "2026-08-10T00:00:00.000Z" });
    expect(await repo.getPhraseLearningState("sys-example")).toMatchObject({ stage: "unseen", consecutiveGood: 0 });
  });

  it("atomically submits the first learning review and advances the matching cursor once", async () => {
    const phraseId = "starter-daily-not-sure";
    const session = learningSession({ phraseIds: [phraseId] });
    await repo.saveLearningSession(session);
    await repo.savePhraseLearningState({
      phraseId, stage: "learning", firstSeenAt: "2026-08-10T07:30:00.000Z",
      consecutiveGood: 0, masteredDates: [], unlockedAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-10T07:30:00.000Z",
    });
    const event: TrainingEvent = {
      id: "first-review", sessionId: session.id, phraseId, source: "new", result: "good",
      usedPronunciationHint: false, recorded: true, activeSeconds: 4,
      occurredAt: "2026-08-10T08:05:00.000Z",
    };
    const nextSession = { ...session, testIndex: 1, updatedAt: event.occurredAt };

    await repo.submitFirstLearningReview(event, nextSession);
    expect(await repo.getPhrase(phraseId)).toMatchObject({ reviewStep: 1, lastReviewedAt: event.occurredAt });
    expect(await repo.getPhraseLearningState(phraseId)).toEqual({
      phraseId, stage: "learned", firstSeenAt: "2026-08-10T07:30:00.000Z",
      firstTestedAt: event.occurredAt, firstResult: "good", consecutiveGood: 1,
      masteredDates: ["2026-08-10"], unlockedAt: "2026-08-09T00:00:00.000Z", updatedAt: event.occurredAt,
    });
    expect(await repo.getActiveLearningSession()).toEqual(nextSession);
    expect((await repo.exportSnapshot()).reviewLogs.filter(({ phraseId: id }) => id === phraseId)).toHaveLength(1);

    await repo.submitFirstLearningReview(event, nextSession);
    expect((await repo.listTrainingEvents()).filter(({ id }) => id === event.id)).toHaveLength(1);
    expect((await repo.exportSnapshot()).reviewLogs.filter(({ phraseId: id }) => id === phraseId)).toHaveLength(1);
    expect((await repo.getPhrase(phraseId))?.reviewStep).toBe(1);
    expect(await repo.getActiveLearningSession()).toEqual(nextSession);
  });

  it("rejects missing phrases, missing sessions, and mismatched first-review cursors without progress", async () => {
    const phraseId = "starter-daily-not-sure";
    const session = learningSession({ phraseIds: [phraseId] });
    await repo.saveLearningSession(session);
    const event: TrainingEvent = {
      id: "invalid-first-review", sessionId: session.id, phraseId, source: "new", result: "hard",
      usedPronunciationHint: false, recorded: false, activeSeconds: 1,
      occurredAt: "2026-08-10T08:05:00.000Z",
    };
    const before = await repo.exportSnapshot();
    await expect(repo.submitFirstLearningReview({ ...event, id: "missing-phrase", phraseId: "missing" }, { ...session, phraseIds: ["missing"], testIndex: 1 })).rejects.toThrow();
    await expect(repo.submitFirstLearningReview({ ...event, id: "missing-session", sessionId: "missing" }, { ...session, id: "missing", testIndex: 1 })).rejects.toThrow();
    await expect(repo.submitFirstLearningReview(event, { ...session, testIndex: 0 })).rejects.toThrow("首次测试进度不一致");
    const after = await repo.exportSnapshot();
    expect(after.trainingEvents).toEqual(before.trainingEvents);
    expect(after.reviewLogs).toEqual(before.reviewLogs);
    expect(after.phrases).toEqual(before.phrases);
    expect(after.learningSessions).toEqual(before.learningSessions);
  });

  it("rolls back review writes when persisting the proposed cursor fails", async () => {
    const phraseId = "starter-daily-not-sure";
    const session = learningSession({ phraseIds: [phraseId] });
    await repo.saveLearningSession(session);
    const event: TrainingEvent = {
      id: "uncloneable-cursor", sessionId: session.id, phraseId, source: "new", result: "again",
      usedPronunciationHint: false, recorded: false, activeSeconds: 1,
      occurredAt: "2026-08-10T08:05:00.000Z",
    };
    const before = await repo.exportSnapshot();
    const broken = { ...session, testIndex: 1, updatedAt: event.occurredAt, cannotClone: () => undefined } as LearningSessionRecord;
    await expect(repo.submitFirstLearningReview(event, broken)).rejects.toThrow();
    const after = await repo.exportSnapshot();
    expect(after.trainingEvents).toEqual(before.trainingEvents);
    expect(after.reviewLogs).toEqual(before.reviewLogs);
    expect(after.phrases).toEqual(before.phrases);
    expect(after.phraseLearningStates).toEqual(before.phraseLearningStates);
    expect(after.learningSessions).toEqual(before.learningSessions);
  });

  it("migrates v3 evidence into complete learning states while preserving metadata", async () => {
    globalThis.indexedDB = new IDBFactory();
    const dbName = `phrase-bank-v3-${crypto.randomUUID()}`;
    const request = indexedDB.open(dbName, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      const phrases = db.createObjectStore("phrases", { keyPath: "id" });
      phrases.createIndex("by-due", "nextReviewAt"); phrases.createIndex("by-created", "createdAt");
      phrases.createIndex("by-category", "categoryId"); phrases.createIndex("by-origin", "origin"); phrases.createIndex("by-parent", "parentPhraseId");
      db.createObjectStore("categories", { keyPath: "id" });
      const logs = db.createObjectStore("reviewLogs", { keyPath: "id" }); logs.createIndex("by-phrase", "phraseId");
      db.createObjectStore("metadata", { keyPath: "key" });
      const events = db.createObjectStore("trainingEvents", { keyPath: "id" }); events.createIndex("by-occurred", "occurredAt"); events.createIndex("by-session", "sessionId"); events.createIndex("by-phrase", "phraseId");
      const sessions = db.createObjectStore("trainingSessions", { keyPath: "id" }); sessions.createIndex("by-updated", "updatedAt");
      db.createObjectStore("phraseLearningState", { keyPath: "phraseId" });
      db.createObjectStore("systemContentPackages", { keyPath: "version" });
    };
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const timestamp = "2026-08-08T08:00:00.000Z";
    const phrase = (id: string, masteryLevel: number, origin: "personal" | "system" = "personal"): Phrase => ({
      id, english: id, chinese: id, categoryId: "daily", origin, kind: origin === "system" ? "core" : "standalone",
      reviewStep: masteryLevel, masteryLevel, nextReviewAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    });
    const tx = oldDb.transaction(Array.from(oldDb.objectStoreNames), "readwrite");
    tx.objectStore("categories").put({ id: "daily", name: "日常", isDefault: true, createdAt: timestamp, updatedAt: timestamp });
    tx.objectStore("metadata").put({ key: "initialized", value: "1" }); tx.objectStore("metadata").put({ key: "starterPhrasesVersion", value: "1" });
    for (const item of [phrase("reviewed", 1), phrase("mastered", 3), phrase("last-reviewed-only", 1), phrase("system-new", 0, "system")]) tx.objectStore("phrases").put(item);
    tx.objectStore("phrases").put({ ...phrase("last-reviewed-only", 1), lastReviewedAt: "2026-08-09T07:00:00.000Z" });
    tx.objectStore("trainingEvents").put({ id: "e1", sessionId: "old", phraseId: "reviewed", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-08T09:00:00.000Z" });
    tx.objectStore("trainingEvents").put({ id: "e2", sessionId: "old", phraseId: "reviewed", source: "new", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T09:00:00.000Z" });
    tx.objectStore("trainingEvents").put({ id: "e3", sessionId: "old", phraseId: "reviewed", source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T09:00:00.000Z" });
    tx.objectStore("reviewLogs").put({ id: "master-log", phraseId: "mastered", result: "good", reviewedAt: "2026-08-09T10:00:00.000Z", previousStep: 2, nextReviewAt: timestamp });
    tx.objectStore("reviewLogs").put({ id: "reviewed-late-log", phraseId: "reviewed", result: "hard", reviewedAt: "2026-08-11T10:00:00.000Z", previousStep: 1, nextReviewAt: timestamp });
    tx.objectStore("phraseLearningState").put({ phraseId: "reviewed", masteredDates: ["2026-08-08"], unlockedAt: "2026-08-07T00:00:00.000Z", updatedAt: "2026-08-10T09:00:00.000Z", legacyNote: "keep" });
    tx.objectStore("phraseLearningState").put({ phraseId: "system-new", masteredDates: [], unlockedAt: timestamp, updatedAt: timestamp });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); oldDb.close();

    const migrated = new LocalPhraseRepository(dbName);
    await migrated.initialize();
    expect(await migrated.getPhraseLearningState("reviewed")).toMatchObject({
      stage: "learned", firstSeenAt: "2026-08-08T09:00:00.000Z", firstTestedAt: "2026-08-08T09:00:00.000Z",
      firstResult: "good", consecutiveGood: 1, masteredDates: ["2026-08-08"], unlockedAt: "2026-08-07T00:00:00.000Z", legacyNote: "keep",
    });
    expect(await migrated.getPhraseLearningState("mastered")).toMatchObject({ stage: "mastered", consecutiveGood: 0, firstResult: "good" });
    expect(await migrated.getPhraseLearningState("last-reviewed-only")).toEqual({
      phraseId: "last-reviewed-only", stage: "learning", firstSeenAt: "2026-08-09T07:00:00.000Z",
      consecutiveGood: 0, masteredDates: [], updatedAt: timestamp,
    });
    expect(await migrated.getPhraseLearningState("system-new")).toMatchObject({ stage: "unseen", consecutiveGood: 0, unlockedAt: timestamp });
    const reopened = indexedDB.open(dbName, 4);
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => { reopened.onsuccess = () => resolve(reopened.result); reopened.onerror = () => reject(reopened.error); });
    expect(upgraded.objectStoreNames.contains("learningSessions")).toBe(true);
    expect(Array.from(upgraded.transaction("learningSessions").objectStore("learningSessions").indexNames)).toContain("by-updated");
  });

  it("includes learning sessions in v4 snapshots and preserves them across legacy imports", async () => {
    const existing = learningSession({ id: "existing", updatedAt: "2026-08-10T08:00:00.000Z" });
    await repo.saveLearningSession(existing);
    const exported = await repo.exportSnapshot();
    expect(exported).toMatchObject({ version: 4, learningSessions: [existing] });

    const legacy: BackupEnvelopeV1 = {
      format: "personal-phrase-bank", version: 1, exportedAt: exported.exportedAt,
      categories: [], phrases: [], reviewLogs: [],
    };
    await repo.importSnapshot(legacy, "overwrite");
    expect((await repo.exportSnapshot()).learningSessions).toEqual([existing]);

    const incoming = { ...existing, updatedAt: "2026-08-10T09:00:00.000Z", testIndex: 1 };
    await repo.importSnapshot({ ...exported, learningSessions: [incoming] }, "skip");
    expect((await repo.getActiveLearningSession())?.updatedAt).toBe(existing.updatedAt);
    await repo.importSnapshot({ ...exported, learningSessions: [incoming] }, "overwrite");
    expect((await repo.getActiveLearningSession())?.updatedAt).toBe(incoming.updatedAt);
  });

  it("cascades reviewed phrase deletion and remaps training and learning session cursors", async () => {
    const occurredAt = "2026-08-10T08:00:00.000Z";
    const removed = { ...createNewPhrase({ english: "Remove", chinese: "删除", categoryId: "daily" }, new Date(occurredAt)), id: "remove-me" };
    const kept = { ...createNewPhrase({ english: "Keep", chinese: "保留", categoryId: "daily" }, new Date(occurredAt)), id: "keep-me" };
    await repo.savePhrase(removed); await repo.savePhrase(kept);
    await repo.saveTrainingSession({
      id: "delete-training", mode: "quick", startedAt: occurredAt, updatedAt: occurredAt,
      phraseIds: [removed.id, kept.id], sources: ["new", "weak"], currentIndex: 1, activeSeconds: 3,
    });
    await repo.saveTrainingSession({
      id: "delete-empty-training", mode: "quick", startedAt: occurredAt, updatedAt: occurredAt,
      phraseIds: [removed.id], sources: ["new"], currentIndex: 1, activeSeconds: 1,
    });
    await repo.saveLearningSession({
      id: "delete-learning", date: "2026-08-10", themeCategoryId: "daily",
      phraseIds: [removed.id, kept.id], studyIndex: 2, testIndex: 1, phase: "test",
      startedAt: occurredAt, updatedAt: occurredAt,
    });
    await repo.saveLearningSession({
      id: "delete-empty-learning", date: "2026-08-10", themeCategoryId: "daily",
      phraseIds: [removed.id], studyIndex: 1, testIndex: 1, phase: "test",
      startedAt: occurredAt, updatedAt: occurredAt, completedAt: occurredAt,
    });
    await repo.submitTrainingReview({
      id: "delete-event", sessionId: "delete-training", phraseId: removed.id, source: "new", result: "good",
      usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt,
    });

    await repo.deletePhrase(removed.id);

    const snapshot = await repo.exportSnapshot();
    expect(snapshot.phrases.find(({ id }) => id === removed.id)).toBeUndefined();
    expect(snapshot.phraseLearningStates.find(({ phraseId }) => phraseId === removed.id)).toBeUndefined();
    expect(snapshot.reviewLogs.find(({ phraseId }) => phraseId === removed.id)).toBeUndefined();
    expect(snapshot.trainingEvents.find(({ phraseId }) => phraseId === removed.id)).toBeUndefined();
    expect(snapshot.trainingSessions.find(({ id }) => id === "delete-training")).toMatchObject({
      phraseIds: [kept.id], sources: ["weak"], currentIndex: 0, updatedAt: occurredAt,
    });
    expect(snapshot.trainingSessions.find(({ id }) => id === "delete-empty-training")).toBeUndefined();
    expect(snapshot.learningSessions.find(({ id }) => id === "delete-learning")).toMatchObject({
      phraseIds: [kept.id], studyIndex: 1, testIndex: 0, updatedAt: occurredAt,
    });
    expect(snapshot.learningSessions.find(({ id }) => id === "delete-empty-learning")).toBeUndefined();
    expect(parseBackup(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects conflicting or incomplete pre-existing first-review events without changing data", async () => {
    const phraseId = "starter-daily-not-sure";
    const session = learningSession({ id: "preexisting-session", phraseIds: [phraseId] });
    await repo.saveLearningSession(session);
    const event: TrainingEvent = {
      id: "preexisting-event", sessionId: session.id, phraseId, source: "new", result: "good",
      usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T08:05:00.000Z",
    };
    await repo.saveTrainingEvent(event);
    const before = await repo.exportSnapshot();
    await expect(repo.submitFirstLearningReview(event, { ...session, testIndex: 1, updatedAt: event.occurredAt })).rejects.toThrow("首次测试记录状态不一致");
    await expect(repo.submitFirstLearningReview({ ...event, result: "hard" }, { ...session, testIndex: 1, updatedAt: event.occurredAt })).rejects.toThrow("事件ID冲突");
    const after = await repo.exportSnapshot();
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });

  it("normalizes direct v1 and v2 imports into learned and mastered states", async () => {
    const exported = await repo.exportSnapshot();
    const phrase = (id: string, masteryLevel: number): Phrase => ({
      id, english: id, chinese: id, categoryId: "daily", origin: "personal", kind: "standalone",
      reviewStep: masteryLevel, masteryLevel, nextReviewAt: exported.exportedAt, createdAt: exported.exportedAt, updatedAt: exported.exportedAt,
    });
    const v1Phrase = phrase("direct-v1", 1);
    const v1: BackupEnvelopeV1 = {
      format: "personal-phrase-bank", version: 1, exportedAt: exported.exportedAt,
      categories: exported.categories, phrases: [v1Phrase],
      reviewLogs: [{ id: "direct-v1-log", phraseId: v1Phrase.id, result: "hard", reviewedAt: exported.exportedAt, previousStep: 0, nextReviewAt: exported.exportedAt }],
    };
    await repo.importSnapshot(v1, "overwrite");
    expect(await repo.getPhraseLearningState(v1Phrase.id)).toMatchObject({ stage: "learned", firstResult: "hard", consecutiveGood: 0 });

    const v2Phrase = phrase("direct-v2", 3);
    const v2Session: TrainingSessionRecord = { id: "direct-v2-session", mode: "quick", startedAt: exported.exportedAt, updatedAt: exported.exportedAt, phraseIds: [v2Phrase.id], currentIndex: 0, activeSeconds: 2 };
    const v2: BackupEnvelopeV2 = {
      format: "personal-phrase-bank", version: 2, exportedAt: exported.exportedAt,
      categories: exported.categories, phrases: [v2Phrase], reviewLogs: [], trainingSessions: [v2Session],
      trainingEvents: [
        { id: "direct-v2-1", sessionId: v2Session.id, phraseId: v2Phrase.id, source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T08:00:00.000Z" },
        { id: "direct-v2-2", sessionId: v2Session.id, phraseId: v2Phrase.id, source: "new", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-10T08:00:00.000Z" },
      ],
    };
    await repo.importSnapshot(v2, "overwrite");
    expect(await repo.getPhraseLearningState(v2Phrase.id)).toMatchObject({ stage: "mastered", firstResult: "good", consecutiveGood: 2 });
  });

  it("allows only one active learning session, including concurrent creates", async () => {
    const first = learningSession({ id: "only-active" });
    await repo.saveLearningSession(first);
    await expect(repo.saveLearningSession(learningSession({ id: "rejected-active", updatedAt: "2026-08-10T09:00:00.000Z" }))).rejects.toThrow("已有进行中的学习会话");
    expect(await repo.getActiveLearningSession()).toEqual(first);
    await repo.saveLearningSession({ ...first, testIndex: 1, updatedAt: "2026-08-10T09:00:00.000Z" });
    await repo.saveLearningSession(learningSession({ id: "completed-history", testIndex: 1, completedAt: "2026-08-10T08:00:00.000Z" }));
    const firstSnapshot = await repo.exportSnapshot();
    expect(firstSnapshot.learningSessions).toHaveLength(2);
    expect(parseBackup(JSON.stringify(firstSnapshot))).toEqual(firstSnapshot);

    const concurrent = new LocalPhraseRepository(`concurrent-${crypto.randomUUID()}`);
    await concurrent.initialize();
    const settled = await Promise.allSettled([
      concurrent.saveLearningSession(learningSession({ id: "concurrent-a" })),
      concurrent.saveLearningSession(learningSession({ id: "concurrent-b" })),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const snapshot = await concurrent.exportSnapshot();
    expect(snapshot.learningSessions.filter(({ completedAt }) => !completedAt)).toHaveLength(1);
    expect(parseBackup(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("does not trust personal parent links, but cascades direct system examples", async () => {
    const root = { ...createNewPhrase({ english: "Root", chinese: "根", categoryId: "daily" }), id: "personal-root" };
    const malicious = { ...createNewPhrase({ english: "Child", chinese: "子", categoryId: "daily" }), id: "personal-child", parentPhraseId: root.id };
    await repo.savePhrase(root); await repo.savePhrase(malicious);
    await repo.deletePhrase(root.id);
    expect(await repo.getPhrase(malicious.id)).toEqual(malicious);

    await repo.installSystemContentPackage(contentPackage("delete-system"));
    await repo.deletePhrase("sys-core");
    expect(await repo.getPhrase("sys-core")).toBeUndefined();
    expect(await repo.getPhrase("sys-example")).toBeUndefined();
    await repo.deletePhrase(malicious.id);
    const snapshot = await repo.exportSnapshot();
    expect(parseBackup(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
