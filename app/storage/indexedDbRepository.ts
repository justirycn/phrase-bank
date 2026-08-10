import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupEnvelope, BackupEnvelopeV2, Category, Phrase, PhraseLearningState, ReviewLog, ReviewResult, SpeechPreferences, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../domain/types";
import { scheduleReview } from "../domain/review";
import { personalPhraseDefaults, validateSystemContentPackage } from "../domain/systemContent";
import { defaultCategories } from "./seed";
import { STARTER_PHRASES } from "./starterPhrases";
import type { PhraseRepository } from "./repository";

interface PhraseBankDb extends DBSchema {
  phrases: { key: string; value: Phrase; indexes: { "by-due": string; "by-created": string; "by-category": string; "by-origin": string; "by-parent": string } };
  categories: { key: string; value: Category };
  reviewLogs: { key: string; value: ReviewLog; indexes: { "by-phrase": string } };
  metadata: { key: string; value: { key: string; value: string } };
  trainingEvents: { key: string; value: TrainingEvent; indexes: { "by-occurred": string; "by-session": string; "by-phrase": string } };
  trainingSessions: { key: string; value: TrainingSessionRecord; indexes: { "by-updated": string } };
  phraseLearningState: { key: string; value: PhraseLearningState };
  systemContentPackages: { key: string; value: SystemContentPackage };
}

export class LocalPhraseRepository implements PhraseRepository {
  private dbPromise?: Promise<IDBPDatabase<PhraseBankDb>>;
  constructor(private readonly dbName = "personal-phrase-bank") {}

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<PhraseBankDb>(this.dbName, 3, {
        async upgrade(db, oldVersion, _newVersion, transaction) {
          if (oldVersion < 1) {
            const phrases = db.createObjectStore("phrases", { keyPath: "id" });
            phrases.createIndex("by-due", "nextReviewAt");
            phrases.createIndex("by-created", "createdAt");
            phrases.createIndex("by-category", "categoryId");
            phrases.createIndex("by-origin", "origin");
            phrases.createIndex("by-parent", "parentPhraseId");
            db.createObjectStore("categories", { keyPath: "id" });
            const logs = db.createObjectStore("reviewLogs", { keyPath: "id" });
            logs.createIndex("by-phrase", "phraseId");
            db.createObjectStore("metadata", { keyPath: "key" });
          }
          if (oldVersion < 2) {
            const events = db.createObjectStore("trainingEvents", { keyPath: "id" });
            events.createIndex("by-occurred", "occurredAt");
            events.createIndex("by-session", "sessionId");
            events.createIndex("by-phrase", "phraseId");
            const sessions = db.createObjectStore("trainingSessions", { keyPath: "id" });
            sessions.createIndex("by-updated", "updatedAt");
          }
          if (oldVersion < 3) {
            const phrases = transaction.objectStore("phrases");
            if (!phrases.indexNames.contains("by-origin")) phrases.createIndex("by-origin", "origin");
            if (!phrases.indexNames.contains("by-parent")) phrases.createIndex("by-parent", "parentPhraseId");
            let cursor = await phrases.openCursor();
            while (cursor) {
              const phrase = cursor.value;
              if (!phrase.origin || !phrase.kind) await cursor.update({ ...personalPhraseDefaults(), ...phrase });
              cursor = await cursor.continue();
            }
            db.createObjectStore("phraseLearningState", { keyPath: "phraseId" });
            db.createObjectStore("systemContentPackages", { keyPath: "version" });
          }
        },
      });
    }
    return this.dbPromise;
  }

  async initialize() {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "metadata"], "readwrite");
    const metadata = tx.objectStore("metadata");
    const initialized = await metadata.get("initialized");
    if (!initialized) {
      for (const item of defaultCategories()) await tx.objectStore("categories").put(item);
      await metadata.put({ key: "initialized", value: "1" });
    }

    const starterVersion = await metadata.get("starterPhrasesVersion");
    if (starterVersion?.value !== "1") {
      const timestamp = new Date().toISOString();
      const phraseStore = tx.objectStore("phrases");
      for (const starter of STARTER_PHRASES) {
        if (await phraseStore.get(starter.id)) continue;
        await phraseStore.put({
          ...starter,
          ...personalPhraseDefaults(),
          sourceNote: "",
          reviewStep: 0,
          masteryLevel: 0,
          nextReviewAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await metadata.put({ key: "starterPhrasesVersion", value: "1" });
    }
    await tx.done;
  }

  async listPhrases() {
    return (await (await this.db()).getAllFromIndex("phrases", "by-created")).reverse();
  }
  async getPhrase(id: string) { return (await this.db()).get("phrases", id); }
  async savePhrase(phrase: Phrase) { await (await this.db()).put("phrases", phrase); }
  async deletePhrase(id: string) { await (await this.db()).delete("phrases", id); }
  async listDuePhrases(now = new Date()) {
    const items = await (await this.db()).getAllFromIndex("phrases", "by-due", IDBKeyRange.upperBound(now.toISOString()));
    return items.sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
  }
  async submitReview(id: string, result: ReviewResult, now = new Date()) {
    const db = await this.db();
    const tx = db.transaction(["phrases", "reviewLogs"], "readwrite");
    const phrase = await tx.objectStore("phrases").get(id);
    if (!phrase) throw new Error("找不到这条语言块");
    const scheduled = scheduleReview(phrase, result, now);
    await tx.objectStore("phrases").put(scheduled.phrase);
    await tx.objectStore("reviewLogs").put(scheduled.log);
    await tx.done;
  }
  async listCategories() { return (await (await this.db()).getAll("categories")).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async saveCategory(category: Category) { await (await this.db()).put("categories", category); }
  async deleteCategoryAndMigrate(id: string, targetId: string) {
    if (id === targetId) throw new Error("请选择其他分类");
    const db = await this.db();
    const tx = db.transaction(["phrases", "categories"], "readwrite");
    const phrases = await tx.objectStore("phrases").index("by-category").getAll(id);
    for (const phrase of phrases) await tx.objectStore("phrases").put({ ...phrase, categoryId: targetId, updatedAt: new Date().toISOString() });
    await tx.objectStore("categories").delete(id);
    await tx.done;
  }
  async saveTrainingEvent(event: TrainingEvent) { await (await this.db()).put("trainingEvents", event); }
  async listTrainingEvents(from?: Date, to?: Date) {
    const range = from && to
      ? IDBKeyRange.bound(from.toISOString(), to.toISOString())
      : from
        ? IDBKeyRange.lowerBound(from.toISOString())
        : to
          ? IDBKeyRange.upperBound(to.toISOString())
          : undefined;
    return (await this.db()).getAllFromIndex("trainingEvents", "by-occurred", range);
  }
  async saveTrainingSession(session: TrainingSessionRecord) { await (await this.db()).put("trainingSessions", session); }
  async getActiveTrainingSession() {
    const sessions = await (await this.db()).getAllFromIndex("trainingSessions", "by-updated");
    return sessions.reverse().find((session) => !session.completedAt);
  }
  async completeTrainingSession(id: string, completedAt: Date) {
    const db = await this.db();
    const tx = db.transaction("trainingSessions", "readwrite");
    const store = tx.objectStore("trainingSessions");
    const session = await store.get(id);
    if (!session) throw new Error("找不到训练会话");
    const timestamp = completedAt.toISOString();
    await store.put({ ...session, completedAt: timestamp, updatedAt: timestamp });
    await tx.done;
  }
  async submitTrainingReview(event: TrainingEvent) {
    const db = await this.db();
    const tx = db.transaction(["trainingEvents", "phrases", "reviewLogs"], "readwrite");
    const eventStore = tx.objectStore("trainingEvents");
    if (await eventStore.get(event.id)) {
      await tx.done;
      return;
    }
    const phraseStore = tx.objectStore("phrases");
    const phrase = await phraseStore.get(event.phraseId);
    if (!phrase) {
      tx.abort();
      try { await tx.done; } catch { /* The explicit abort preserves the atomic boundary. */ }
      throw new Error("找不到这条语言块");
    }
    const scheduled = scheduleReview(phrase, event.result, new Date(event.occurredAt));
    await phraseStore.put(scheduled.phrase);
    await tx.objectStore("reviewLogs").put(scheduled.log);
    await eventStore.put(event);
    await tx.done;
  }
  async getSpeechPreferences(): Promise<SpeechPreferences> {
    const fallback: SpeechPreferences = { accent: "en-US", autoSpeak: true };
    const item = await (await this.db()).get("metadata", "speechPreferences");
    if (!item) return fallback;
    try {
      const value = JSON.parse(item.value) as Partial<SpeechPreferences>;
      return (value.accent === "en-US" || value.accent === "en-GB") && typeof value.autoSpeak === "boolean" ? value as SpeechPreferences : fallback;
    } catch { return fallback; }
  }
  async saveSpeechPreferences(preferences: SpeechPreferences) {
    await (await this.db()).put("metadata", { key: "speechPreferences", value: JSON.stringify(preferences) });
  }
  async listPhraseLearningStates() { return (await this.db()).getAll("phraseLearningState"); }
  async getActiveSystemContentVersion() {
    return (await (await this.db()).get("metadata", "activeSystemContentVersion"))?.value;
  }
  async installSystemContentPackage(content: SystemContentPackage) {
    const validated = validateSystemContentPackage(content);
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "phraseLearningState", "systemContentPackages", "metadata"], "readwrite");
    const categories = new Set((await tx.objectStore("categories").getAllKeys()).map(String));
    if (validated.phrases.some(({ categoryId }) => !categories.has(categoryId))) {
      tx.abort();
      try { await tx.done; } catch { /* validation abort */ }
      throw new Error("系统内容包无效：分类不存在");
    }
    const phraseStore = tx.objectStore("phrases");
    const stateStore = tx.objectStore("phraseLearningState");
    const incomingIds = new Set(validated.phrases.map(({ id }) => id));
    const timestamp = validated.generatedAt;
    for (const existing of await phraseStore.index("by-origin").getAll("system")) {
      if (!incomingIds.has(existing.id) && !existing.retiredAt) await phraseStore.put({ ...existing, retiredAt: timestamp, updatedAt: timestamp });
    }
    for (const item of validated.phrases) {
      const existing = await phraseStore.get(item.id);
      if (existing?.origin === "personal" || (existing && !existing.origin)) {
        tx.abort();
        try { await tx.done; } catch { /* collision abort */ }
        throw new Error("系统内容不能覆盖个人句子");
      }
      const scheduled = existing ?? {
        reviewStep: 0, masteryLevel: 0, nextReviewAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      };
      await phraseStore.put({ ...scheduled, ...item, personalExample: item.personalExample ?? "", sourceNote: item.sourceNote ?? "", retiredAt: undefined, updatedAt: timestamp });
      if (!await stateStore.get(item.id)) {
        await stateStore.put({ phraseId: item.id, masteredDates: [], unlockedAt: item.kind === "core" ? timestamp : undefined, updatedAt: timestamp });
      }
    }
    await tx.objectStore("systemContentPackages").put(validated);
    await tx.objectStore("metadata").put({ key: "activeSystemContentVersion", value: validated.version });
    await tx.done;
  }
  async rollbackSystemContentPackage(version: string) {
    const content = await (await this.db()).get("systemContentPackages", version);
    if (!content) throw new Error("找不到可回滚的系统内容版本");
    await this.installSystemContentPackage(content);
  }
  async exportSnapshot(): Promise<BackupEnvelopeV2> {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions"]);
    const [categories, phrases, reviewLogs, trainingEvents, trainingSessions] = await Promise.all([
      tx.objectStore("categories").getAll(),
      tx.objectStore("phrases").getAll(),
      tx.objectStore("reviewLogs").getAll(),
      tx.objectStore("trainingEvents").getAll(),
      tx.objectStore("trainingSessions").getAll(),
    ]);
    await tx.done;
    return { format: "personal-phrase-bank", version: 2, exportedAt: new Date().toISOString(), categories, phrases, reviewLogs, trainingEvents, trainingSessions };
  }

  async importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite") {
    const db = await this.db();
    const stores = snapshot.version === 2 ? ["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions"] as const : ["categories", "phrases", "reviewLogs"] as const;
    const tx = db.transaction(stores, "readwrite");
    const put = async <S extends typeof stores[number]>(store: S, records: PhraseBankDb[S]["value"][]) => {
      for (const record of records) {
        if (policy === "skip" && await tx.objectStore(store).get(record.id)) continue;
        await tx.objectStore(store).put(record as never);
      }
    };
    await put("categories", snapshot.categories);
    await put("phrases", snapshot.phrases);
    await put("reviewLogs", snapshot.reviewLogs);
    if (snapshot.version === 2) {
      await put("trainingEvents", snapshot.trainingEvents);
      await put("trainingSessions", snapshot.trainingSessions);
    }
    await tx.done;
  }
}
