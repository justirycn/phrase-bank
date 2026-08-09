import { beforeEach, describe, expect, it } from "vitest";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";
import { createNewPhrase } from "../../app/domain/review";
import type { BackupEnvelopeV1, BackupEnvelopeV2, Category, Phrase, ReviewLog, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

describe("LocalPhraseRepository", () => {
  let repo: LocalPhraseRepository;

  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    repo = new LocalPhraseRepository(`phrase-bank-${crypto.randomUUID()}`);
    await repo.initialize();
  });

  it("seeds the eight default categories once", async () => {
    expect(await repo.listCategories()).toHaveLength(8);
    expect(await repo.listPhrases()).toHaveLength(40);
    await repo.initialize();
    expect(await repo.listCategories()).toHaveLength(8);
    expect(await repo.listPhrases()).toHaveLength(40);
  });

  it("does not restore a starter phrase deleted after initialization", async () => {
    await repo.deletePhrase("starter-daily-not-sure");
    await repo.initialize();
    expect(await repo.getPhrase("starter-daily-not-sure")).toBeUndefined();
    expect(await repo.listPhrases()).toHaveLength(39);
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
  });

  it("deduplicates events and lists inclusive time ranges in chronological order", async () => {
    const event = (id: string, occurredAt: string): TrainingEvent => ({ id, sessionId: "s1", phraseId: "starter-daily-not-sure", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 2, occurredAt });
    await repo.saveTrainingEvent(event("late", "2026-08-07T10:00:00.000Z"));
    await repo.saveTrainingEvent(event("early", "2026-08-07T08:00:00.000Z"));
    await repo.saveTrainingEvent(event("late", "2026-08-07T10:00:00.000Z"));
    expect((await repo.listTrainingEvents()).map(({ id }) => id)).toEqual(["early", "late"]);
    expect((await repo.listTrainingEvents(new Date("2026-08-07T08:00:00.000Z"), new Date("2026-08-07T08:00:00.000Z"))).map(({ id }) => id)).toEqual(["early"]);
  });

  it("returns the newest incomplete session and completes sessions", async () => {
    const session = (id: string, updatedAt: string, completedAt?: string): TrainingSessionRecord => ({ id, mode: "quick", startedAt: updatedAt, updatedAt, completedAt, phraseIds: [], currentIndex: 0, activeSeconds: 0 });
    await repo.saveTrainingSession(session("older", "2026-08-07T08:00:00.000Z"));
    await repo.saveTrainingSession(session("completed-newest", "2026-08-07T10:00:00.000Z", "2026-08-07T10:00:00.000Z"));
    await repo.saveTrainingSession(session("newest-active", "2026-08-07T09:00:00.000Z"));
    expect((await repo.getActiveTrainingSession())?.id).toBe("newest-active");
    const completedAt = new Date("2026-08-07T11:00:00.000Z");
    await repo.completeTrainingSession("newest-active", completedAt);
    expect((await repo.exportSnapshot()).trainingSessions.find(({ id }) => id === "newest-active")).toMatchObject({ completedAt: completedAt.toISOString(), updatedAt: completedAt.toISOString() });
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
    expect(snapshot.version).toBe(2);
    const dbName = `phrase-bank-${crypto.randomUUID()}`;
    const corruptRepo = new LocalPhraseRepository(dbName);
    await corruptRepo.initialize();
    const request = indexedDB.open(dbName, 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction("metadata", "readwrite");
    tx.objectStore("metadata").put({ key: "speechPreferences", value: "{" });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    expect(await corruptRepo.getSpeechPreferences()).toEqual({ accent: "en-US", autoSpeak: true });
  });

  it("exports v2 and imports v1/v2 training data with skip and overwrite policies", async () => {
    const base = await repo.exportSnapshot();
    expect(base).toMatchObject({ version: 2, trainingEvents: [], trainingSessions: [] });
    const v1: BackupEnvelopeV1 = { format: base.format, version: 1, exportedAt: base.exportedAt, categories: [], phrases: [], reviewLogs: [] };
    await repo.importSnapshot(v1, "overwrite");
    expect((await repo.exportSnapshot()).trainingEvents).toEqual([]);
    const event: TrainingEvent = { id: "event", sessionId: "session", phraseId: "starter-daily-not-sure", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: base.exportedAt };
    const session: TrainingSessionRecord = { id: "session", mode: "quick", startedAt: base.exportedAt, updatedAt: base.exportedAt, phraseIds: [event.phraseId], currentIndex: 0, activeSeconds: 1 };
    const v2: BackupEnvelopeV2 = { ...base, trainingEvents: [event], trainingSessions: [session] };
    await repo.importSnapshot(v2, "overwrite");
    await repo.importSnapshot({ ...v2, trainingEvents: [{ ...event, activeSeconds: 9 }], trainingSessions: [{ ...session, activeSeconds: 9 }] }, "skip");
    expect((await repo.listTrainingEvents())[0].activeSeconds).toBe(1);
    expect((await repo.exportSnapshot()).trainingSessions[0].activeSeconds).toBe(1);
    await repo.importSnapshot({ ...v2, trainingEvents: [{ ...event, activeSeconds: 9 }], trainingSessions: [{ ...session, activeSeconds: 9 }] }, "overwrite");
    expect((await repo.listTrainingEvents())[0].activeSeconds).toBe(9);
    expect((await repo.exportSnapshot()).trainingSessions[0].activeSeconds).toBe(9);
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
    tx.objectStore("categories").put(category); tx.objectStore("phrases").put(phrase); tx.objectStore("reviewLogs").put(log); tx.objectStore("metadata").put({ key: "initialized", value: "custom-value" }); tx.objectStore("metadata").put({ key: "starterPhrasesVersion", value: "1" });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); oldDb.close();
    const migrated = new LocalPhraseRepository(dbName); await migrated.initialize();
    expect(await migrated.getPhrase(phrase.id)).toEqual(phrase);
    expect(await migrated.listCategories()).toContainEqual(category);
    expect((await migrated.exportSnapshot()).reviewLogs).toContainEqual(log);
    const reopened = indexedDB.open(dbName, 2);
    const upgradedDb = await new Promise<IDBDatabase>((resolve, reject) => { reopened.onsuccess = () => resolve(reopened.result); reopened.onerror = () => reject(reopened.error); });
    const metadata = await new Promise<{ key: string; value: string }>((resolve, reject) => { const read = upgradedDb.transaction("metadata").objectStore("metadata").get("initialized"); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
    expect(metadata.value).toBe("custom-value");
    await migrated.saveTrainingSession({ id: "new-session", mode: "quick", startedAt: timestamp, updatedAt: timestamp, phraseIds: [phrase.id], currentIndex: 0, activeSeconds: 0 });
    expect((await migrated.getActiveTrainingSession())?.id).toBe("new-session");
  });
});
