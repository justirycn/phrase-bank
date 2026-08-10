import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupEnvelope, BackupEnvelopeV4, Category, LearningSessionRecord, Phrase, PhraseLearningState, ReviewLog, ReviewResult, SpeechPreferences, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../domain/types";
import { scheduleReview } from "../domain/review";
import { personalPhraseDefaults, validateSystemContentPackage } from "../domain/systemContent";
import { applyLearningResult, nextExampleToUnlock } from "../domain/learningProgress";
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
  learningSessions: { key: string; value: LearningSessionRecord; indexes: { "by-updated": string } };
}

type LegacyLearningState = Partial<PhraseLearningState> & Pick<PhraseLearningState, "phraseId">;

const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function reviewEvidence(logs: ReviewLog[], events: TrainingEvent[]) {
  const unique = new Map<string, { occurredAt: string; result: ReviewResult }>();
  for (const item of logs) unique.set(`${item.reviewedAt}|${item.result}`, { occurredAt: item.reviewedAt, result: item.result });
  for (const item of events) unique.set(`${item.occurredAt}|${item.result}`, { occurredAt: item.occurredAt, result: item.result });
  return [...unique.values()].filter(({ occurredAt }) => validDate(occurredAt)).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function consecutiveGoodFrom(evidence: Array<{ result: ReviewResult }>) {
  let count = 0;
  for (let index = evidence.length - 1; index >= 0 && evidence[index].result === "good"; index -= 1) count += 1;
  return count;
}

function migrateLearningState(phrase: Phrase, legacy: LegacyLearningState | undefined, logs: ReviewLog[], events: TrainingEvent[]): PhraseLearningState {
  const evidence = reviewEvidence(logs, events);
  const earliest = evidence[0];
  const reviewedAt = earliest?.occurredAt ?? (validDate(phrase.lastReviewedAt) ? phrase.lastReviewedAt : undefined);
  const firstSeenAt = reviewedAt ?? (validDate(legacy?.firstSeenAt) ? legacy.firstSeenAt : undefined);
  const firstTestedAt = reviewedAt ?? (validDate(legacy?.firstTestedAt) ? legacy.firstTestedAt : undefined);
  const firstResult = earliest?.result ?? (legacy?.firstResult === "again" || legacy?.firstResult === "hard" || legacy?.firstResult === "good" ? legacy.firstResult : undefined);
  const masteredDates = Array.isArray(legacy?.masteredDates) ? legacy.masteredDates.filter((day): day is string => typeof day === "string") : [];
  const hasCompleteStage = (legacy?.stage === "learned" || legacy?.stage === "mastered") && firstSeenAt && firstTestedAt && firstResult;
  const stage: PhraseLearningState["stage"] = hasCompleteStage
    ? legacy.stage as "learned" | "mastered"
    : reviewedAt
      ? phrase.masteryLevel === 3 || masteredDates.length >= 2 ? "mastered" : "learned"
      : firstSeenAt ? "learning" : "unseen";
  const updatedAt = validDate(legacy?.updatedAt)
    ? legacy.updatedAt
    : validDate(phrase.updatedAt) ? phrase.updatedAt : reviewedAt ?? phrase.createdAt;
  return {
    ...legacy,
    phraseId: phrase.id,
    stage,
    firstSeenAt: stage === "unseen" ? undefined : firstSeenAt,
    firstTestedAt: stage === "learned" || stage === "mastered" ? firstTestedAt : undefined,
    firstResult: stage === "learned" || stage === "mastered" ? firstResult : undefined,
    consecutiveGood: consecutiveGoodFrom(evidence),
    masteredDates,
    unlockedAt: validDate(legacy?.unlockedAt) ? legacy.unlockedAt : undefined,
    updatedAt,
  };
}

function unseenState(phraseId: string, updatedAt: string, unlockedAt?: string): PhraseLearningState {
  return { phraseId, stage: "unseen", consecutiveGood: 0, masteredDates: [], unlockedAt, updatedAt };
}

function reviewedState(current: PhraseLearningState | undefined, phrase: Phrase, result: ReviewResult, now: Date): PhraseLearningState {
  const timestamp = now.toISOString();
  const base = current ?? unseenState(phrase.id, timestamp);
  const progressed = applyLearningResult(base, result, now);
  return {
    ...progressed,
    stage: phrase.masteryLevel === 3 ? "mastered" : "learned",
    firstSeenAt: base.firstSeenAt ?? timestamp,
    firstTestedAt: base.firstTestedAt ?? timestamp,
    firstResult: base.firstResult ?? result,
    consecutiveGood: result === "good" ? base.consecutiveGood + 1 : 0,
    updatedAt: timestamp,
  };
}

export class LocalPhraseRepository implements PhraseRepository {
  private dbPromise?: Promise<IDBPDatabase<PhraseBankDb>>;
  constructor(private readonly dbName = "personal-phrase-bank") {}

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<PhraseBankDb>(this.dbName, 4, {
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
          if (oldVersion < 4) {
            const learningSessions = db.createObjectStore("learningSessions", { keyPath: "id" });
            learningSessions.createIndex("by-updated", "updatedAt");
            const phraseStore = transaction.objectStore("phrases");
            const stateStore = transaction.objectStore("phraseLearningState");
            const logs = await transaction.objectStore("reviewLogs").getAll();
            const events = await transaction.objectStore("trainingEvents").getAll();
            const states = await stateStore.getAll() as unknown as LegacyLearningState[];
            const statesByPhrase = new Map(states.map((state) => [state.phraseId, state]));
            let cursor = await phraseStore.openCursor();
            while (cursor) {
              const phrase = cursor.value;
              await stateStore.put(migrateLearningState(
                phrase,
                statesByPhrase.get(phrase.id),
                logs.filter(({ phraseId }) => phraseId === phrase.id),
                events.filter(({ phraseId }) => phraseId === phrase.id),
              ));
              cursor = await cursor.continue();
            }
          }
        },
      });
    }
    return this.dbPromise;
  }

  async initialize() {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "metadata", "phraseLearningState"], "readwrite");
    const metadata = tx.objectStore("metadata");
    const initialized = await metadata.get("initialized");
    if (!initialized) {
      for (const item of defaultCategories()) await tx.objectStore("categories").put(item);
      await metadata.put({ key: "initialized", value: "1" });
    }
    if (!await tx.objectStore("categories").get("work")) {
      const work = defaultCategories().find(({ id }) => id === "work");
      if (work) await tx.objectStore("categories").put(work);
    }

    const starterVersion = await metadata.get("starterPhrasesVersion");
    if (starterVersion?.value !== "1") {
      const timestamp = new Date().toISOString();
      const phraseStore = tx.objectStore("phrases");
      const stateStore = tx.objectStore("phraseLearningState");
      for (const starter of STARTER_PHRASES) {
        const existing = await phraseStore.get(starter.id);
        if (!existing) {
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
        if (!await stateStore.get(starter.id)) await stateStore.put(unseenState(starter.id, existing?.updatedAt ?? timestamp));
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
    const tx = db.transaction(["phrases", "reviewLogs", "phraseLearningState"], "readwrite");
    const phrase = await tx.objectStore("phrases").get(id);
    if (!phrase) throw new Error("找不到这条语言块");
    const scheduled = scheduleReview(phrase, result, now);
    await tx.objectStore("phrases").put(scheduled.phrase);
    await tx.objectStore("reviewLogs").put(scheduled.log);
    const stateStore = tx.objectStore("phraseLearningState");
    const currentState = await stateStore.get(id);
    const nextState = reviewedState(currentState, scheduled.phrase, result, now);
    await stateStore.put(nextState);
    if (phrase.origin === "system") {
      const parentId = phrase.kind === "core" ? phrase.id : phrase.parentPhraseId;
      const examples = parentId ? await tx.objectStore("phrases").index("by-parent").getAll(parentId) : [];
      const states = await stateStore.getAll();
      const unlock = nextExampleToUnlock(phrase, examples, [...states.filter(({ phraseId }) => phraseId !== id), nextState]);
      if (unlock) {
        const target = await stateStore.get(unlock.id) ?? unseenState(unlock.id, now.toISOString());
        await stateStore.put({ ...target, unlockedAt: now.toISOString(), updatedAt: now.toISOString() });
      }
    }
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
    const tx = db.transaction(["trainingEvents", "phrases", "reviewLogs", "phraseLearningState"], "readwrite");
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
    const stateStore = tx.objectStore("phraseLearningState");
    const reviewTime = new Date(event.occurredAt);
    const currentState = await stateStore.get(phrase.id);
    const nextState = reviewedState(currentState, scheduled.phrase, event.result, reviewTime);
    await stateStore.put(nextState);
    if (phrase.origin === "system") {
      const parentId = phrase.kind === "core" ? phrase.id : phrase.parentPhraseId;
      const examples = parentId ? await phraseStore.index("by-parent").getAll(parentId) : [];
      const states = await stateStore.getAll();
      const unlock = nextExampleToUnlock(phrase, examples, [...states.filter(({ phraseId }) => phraseId !== phrase.id), nextState]);
      if (unlock) {
        const target = await stateStore.get(unlock.id) ?? unseenState(unlock.id, event.occurredAt);
        await stateStore.put({ ...target, unlockedAt: event.occurredAt, updatedAt: event.occurredAt });
      }
    }
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
  async getPhraseLearningState(id: string) { return (await this.db()).get("phraseLearningState", id); }
  async savePhraseLearningState(state: PhraseLearningState) { await (await this.db()).put("phraseLearningState", state); }
  async saveLearningSession(session: LearningSessionRecord) { await (await this.db()).put("learningSessions", session); }
  async getActiveLearningSession() {
    const sessions = await (await this.db()).getAllFromIndex("learningSessions", "by-updated");
    return sessions.reverse().find((session) => !session.completedAt);
  }
  async completeLearningSession(id: string, completedAt: Date) {
    const db = await this.db();
    const tx = db.transaction("learningSessions", "readwrite");
    const store = tx.objectStore("learningSessions");
    const session = await store.get(id);
    if (!session) throw new Error("找不到学习会话");
    const timestamp = completedAt.toISOString();
    await store.put({ ...session, completedAt: timestamp, updatedAt: timestamp });
    await tx.done;
  }
  async submitFirstLearningReview(event: TrainingEvent, nextSession: LearningSessionRecord) {
    const db = await this.db();
    const tx = db.transaction(["trainingEvents", "phrases", "reviewLogs", "phraseLearningState", "learningSessions"], "readwrite");
    try {
      const eventStore = tx.objectStore("trainingEvents");
      if (await eventStore.get(event.id)) {
        await tx.done;
        return;
      }
      const phraseStore = tx.objectStore("phrases");
      const sessionStore = tx.objectStore("learningSessions");
      const phrase = await phraseStore.get(event.phraseId);
      const session = await sessionStore.get(event.sessionId);
      const cursorMatches = phrase && session
        && nextSession.id === event.sessionId
        && session.id === event.sessionId
        && session.phase === "test"
        && nextSession.phase === "test"
        && session.phraseIds[session.testIndex] === event.phraseId
        && nextSession.testIndex === session.testIndex + 1
        && nextSession.phraseIds[nextSession.testIndex - 1] === event.phraseId
        && nextSession.phraseIds.length === session.phraseIds.length
        && nextSession.phraseIds.every((id, index) => id === session.phraseIds[index]);
      if (!phrase || !session || !cursorMatches) throw new Error("首次测试进度不一致");

      const reviewTime = new Date(event.occurredAt);
      const scheduled = scheduleReview(phrase, event.result, reviewTime);
      await phraseStore.put(scheduled.phrase);
      await tx.objectStore("reviewLogs").put(scheduled.log);
      const stateStore = tx.objectStore("phraseLearningState");
      const nextState = reviewedState(await stateStore.get(phrase.id), scheduled.phrase, event.result, reviewTime);
      await stateStore.put(nextState);
      if (phrase.origin === "system") {
        const parentId = phrase.kind === "core" ? phrase.id : phrase.parentPhraseId;
        const examples = parentId ? await phraseStore.index("by-parent").getAll(parentId) : [];
        const states = await stateStore.getAll();
        const unlock = nextExampleToUnlock(phrase, examples, [...states.filter(({ phraseId }) => phraseId !== phrase.id), nextState]);
        if (unlock) {
          const target = await stateStore.get(unlock.id) ?? unseenState(unlock.id, event.occurredAt);
          await stateStore.put({ ...target, unlockedAt: event.occurredAt, updatedAt: event.occurredAt });
        }
      }
      await eventStore.put(event);
      await sessionStore.put(nextSession);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
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
        await stateStore.put(unseenState(item.id, timestamp, item.kind === "core" ? timestamp : undefined));
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
  async exportSnapshot(): Promise<BackupEnvelopeV4> {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions", "phraseLearningState", "learningSessions", "metadata"]);
    const [categories, phrases, reviewLogs, trainingEvents, trainingSessions, phraseLearningStates, learningSessions, activeVersion] = await Promise.all([
      tx.objectStore("categories").getAll(),
      tx.objectStore("phrases").getAll(),
      tx.objectStore("reviewLogs").getAll(),
      tx.objectStore("trainingEvents").getAll(),
      tx.objectStore("trainingSessions").getAll(),
      tx.objectStore("phraseLearningState").getAll(),
      tx.objectStore("learningSessions").getAll(),
      tx.objectStore("metadata").get("activeSystemContentVersion"),
    ]);
    await tx.done;
    return { format: "personal-phrase-bank", version: 4, exportedAt: new Date().toISOString(), categories, phrases, reviewLogs, trainingEvents, trainingSessions, phraseLearningStates, activeSystemContentVersion: activeVersion?.value, learningSessions };
  }

  async importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite") {
    const db = await this.db();
    const stores = snapshot.version === 4
      ? ["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions", "phraseLearningState", "learningSessions", "metadata"] as const
      : snapshot.version === 3
        ? ["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions", "phraseLearningState", "metadata"] as const
        : snapshot.version === 2
          ? ["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions"] as const
          : ["categories", "phrases", "reviewLogs"] as const;
    const tx = db.transaction(stores, "readwrite");
    const put = async <S extends typeof stores[number]>(store: S, records: PhraseBankDb[S]["value"][]) => {
      for (const record of records) {
        const recordKey = "phraseId" in record && store === "phraseLearningState" ? record.phraseId : "id" in record ? record.id : undefined;
        if (policy === "skip" && recordKey !== undefined && await tx.objectStore(store).get(recordKey)) continue;
        await tx.objectStore(store).put(record as never);
      }
    };
    await put("categories", snapshot.categories);
    await put("phrases", snapshot.phrases);
    await put("reviewLogs", snapshot.reviewLogs);
    if (snapshot.version === 2 || snapshot.version === 3 || snapshot.version === 4) {
      await put("trainingEvents", snapshot.trainingEvents);
      await put("trainingSessions", snapshot.trainingSessions);
    }
    if (snapshot.version === 3 || snapshot.version === 4) {
      await put("phraseLearningState", snapshot.phraseLearningStates);
      if (snapshot.activeSystemContentVersion) await tx.objectStore("metadata").put({ key: "activeSystemContentVersion", value: snapshot.activeSystemContentVersion });
    }
    if (snapshot.version === 4) await put("learningSessions", snapshot.learningSessions);
    await tx.done;
  }
}
