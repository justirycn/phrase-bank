import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_DAILY_MASTERY_GOAL, type AppPreferences, type BackupEnvelope, type BackupEnvelopeV5, type Category, type LearningSessionRecord, type Phrase, type PhraseLearningState, type ReviewLog, type ReviewResult, type SpeechPreferences, type SystemContentPackage, type TrainingEvent, type TrainingSessionRecord } from "../domain/types";
import { scheduleReview } from "../domain/review";
import { personalPhraseDefaults, validateSystemContentPackage } from "../domain/systemContent";
import { applyLearningResult, nextExampleToUnlock } from "../domain/learningProgress";
import { DAILY_NEW_PHRASE_LIMIT } from "../domain/learningSelection";
import { defaultCategories } from "./seed";
import { STARTER_PHRASES } from "./starterPhrases";
import { assertValidLearningSession, normalizeLegacyBackup, normalizeLegacyLearningState } from "./backup";
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

const ACTIVE_TRAINING_SESSION_KEY = "activeTrainingSessionId";
const ACTIVE_LEARNING_SESSION_KEY = "activeLearningSessionId";

interface ActiveSessionCursor {
  value: { id: string; completedAt?: string };
  continue(): Promise<ActiveSessionCursor | null>;
}

async function newestActiveSessionId(openCursor: () => Promise<ActiveSessionCursor | null>) {
  let cursor = await openCursor();
  while (cursor) {
    if (!cursor.value.completedAt) return cursor.value.id;
    cursor = await cursor.continue();
  }
  return undefined;
}

function cursorAfterDeletion(phraseIds: string[], cursor: number, deletedIds: Set<string>) {
  return phraseIds.slice(0, Math.min(cursor, phraseIds.length)).filter((id) => !deletedIds.has(id)).length;
}

function sameTrainingEvent(left: TrainingEvent, right: TrainingEvent) {
  return left.id === right.id && left.sessionId === right.sessionId && left.phraseId === right.phraseId
    && left.source === right.source && left.result === right.result
    && left.usedPronunciationHint === right.usedPronunciationHint && left.recorded === right.recorded
    && left.activeSeconds === right.activeSeconds && left.occurredAt === right.occurredAt;
}

function samePhraseIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function assertSameLearningSessionIdentity(current: LearningSessionRecord, next: LearningSessionRecord) {
  if (current.id !== next.id || current.date !== next.date || current.themeCategoryId !== next.themeCategoryId
    || current.startedAt !== next.startedAt || !samePhraseIds(current.phraseIds, next.phraseIds)) {
    throw new Error("学习会话进度不能回退");
  }
}

function assertMonotonicLearningSession(current: LearningSessionRecord, next: LearningSessionRecord) {
  assertSameLearningSessionIdentity(current, next);
  if ((current.phase === "test" && next.phase === "study")
    || next.studyIndex < current.studyIndex || next.testIndex < current.testIndex
    || next.updatedAt < current.updatedAt || (current.completedAt !== undefined && next.completedAt === undefined)) {
    throw new Error("学习会话进度不能回退");
  }
}

function assertLearningSessionSave(current: LearningSessionRecord | undefined, next: LearningSessionRecord) {
  if (!current) {
    if (next.phase !== "study" || next.studyIndex !== 0 || next.testIndex !== 0 || next.completedAt !== undefined) {
      throw new Error("新学习会话必须从学习阶段开始");
    }
    return;
  }
  assertMonotonicLearningSession(current, next);
  if ((current.phase === "study" && next.phase === "test" && next.testIndex !== 0)
    || (current.phase === "test" && next.testIndex > current.testIndex)) {
    throw new Error("测试游标只能通过首次评价推进");
  }
}

function unseenState(phraseId: string, updatedAt: string, unlockedAt?: string): PhraseLearningState {
  return { phraseId, stage: "unseen", consecutiveGood: 0, masteredDates: [], unlockedAt, updatedAt };
}

function reviewedState(current: PhraseLearningState | undefined, phraseId: string, result: ReviewResult, now: Date): PhraseLearningState {
  const timestamp = now.toISOString();
  const base = current ?? unseenState(phraseId, timestamp);
  const progressed = applyLearningResult(base, result, now);
  return {
    ...progressed,
    firstSeenAt: base.firstSeenAt ?? timestamp,
    firstTestedAt: base.firstTestedAt ?? timestamp,
    firstResult: base.firstResult ?? result,
    updatedAt: timestamp,
  };
}

function shanghaiDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("首次测试时间无效");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

export class LocalPhraseRepository implements PhraseRepository {
  private dbPromise?: Promise<IDBPDatabase<PhraseBankDb>>;
  constructor(private readonly dbName = "personal-phrase-bank") {}

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<PhraseBankDb>(this.dbName, 5, {
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
            const states = await stateStore.getAll() as unknown as Array<Partial<PhraseLearningState> & Pick<PhraseLearningState, "phraseId">>;
            const statesByPhrase = new Map(states.map((state) => [state.phraseId, state]));
            let cursor = await phraseStore.openCursor();
            while (cursor) {
              const phrase = cursor.value;
              await stateStore.put(normalizeLegacyLearningState(
                phrase,
                statesByPhrase.get(phrase.id),
                logs,
                events,
              ));
              cursor = await cursor.continue();
            }
          }
          if (oldVersion < 5) {
            const metadata = transaction.objectStore("metadata");
            const activeTrainingId = await newestActiveSessionId(() => transaction.objectStore("trainingSessions").index("by-updated").openCursor(null, "prev"));
            const activeLearningId = await newestActiveSessionId(() => transaction.objectStore("learningSessions").index("by-updated").openCursor(null, "prev"));
            if (activeTrainingId) await metadata.put({ key: ACTIVE_TRAINING_SESSION_KEY, value: activeTrainingId });
            if (activeLearningId) await metadata.put({ key: ACTIVE_LEARNING_SESSION_KEY, value: activeLearningId });
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
  async deletePhrase(id: string) {
    const db = await this.db();
    const tx = db.transaction(["phrases", "phraseLearningState", "reviewLogs", "trainingEvents", "trainingSessions", "learningSessions", "metadata"], "readwrite");
    try {
      const phraseStore = tx.objectStore("phrases");
      const deletedIds = new Set([id]);
      const root = await phraseStore.get(id);
      if (root?.origin === "system" && root.kind === "core") {
        for (const child of await phraseStore.index("by-parent").getAll(root.id)) {
          if (child.origin === "system" && child.kind === "example" && child.parentPhraseId === root.id) deletedIds.add(child.id);
        }
      }

      const logStore = tx.objectStore("reviewLogs");
      const eventStore = tx.objectStore("trainingEvents");
      for (const phraseId of deletedIds) {
        await phraseStore.delete(phraseId);
        await tx.objectStore("phraseLearningState").delete(phraseId);
        for (const key of await logStore.index("by-phrase").getAllKeys(phraseId)) await logStore.delete(key);
        for (const key of await eventStore.index("by-phrase").getAllKeys(phraseId)) await eventStore.delete(key);
      }

      const trainingStore = tx.objectStore("trainingSessions");
      for (const session of await trainingStore.getAll()) {
        if (!session.phraseIds.some((phraseId) => deletedIds.has(phraseId))) continue;
        const retained = session.phraseIds.map((phraseId) => !deletedIds.has(phraseId));
        const phraseIds = session.phraseIds.filter((_phraseId, index) => retained[index]);
        if (phraseIds.length === 0) {
          await trainingStore.delete(session.id);
          continue;
        }
        const { sources, ...preserved } = session;
        await trainingStore.put({
          ...preserved,
          phraseIds,
          ...(sources ? { sources: sources.filter((_source, index) => retained[index]) } : {}),
          currentIndex: cursorAfterDeletion(session.phraseIds, session.currentIndex, deletedIds),
        });
      }

      const learningStore = tx.objectStore("learningSessions");
      for (const session of await learningStore.getAll()) {
        if (!session.phraseIds.some((phraseId) => deletedIds.has(phraseId))) continue;
        const phraseIds = session.phraseIds.filter((phraseId) => !deletedIds.has(phraseId));
        if (phraseIds.length === 0) {
          await learningStore.delete(session.id);
          continue;
        }
        const studyIndex = cursorAfterDeletion(session.phraseIds, session.studyIndex, deletedIds);
        const testIndex = cursorAfterDeletion(session.phraseIds, session.testIndex, deletedIds);
        const reachesTestBoundary = session.phase === "study" && studyIndex === phraseIds.length;
        const remapped: LearningSessionRecord = {
          ...session,
          phraseIds,
          studyIndex,
          testIndex: reachesTestBoundary ? 0 : testIndex,
          phase: reachesTestBoundary ? "test" : session.phase,
        };
        assertValidLearningSession(remapped);
        await learningStore.put(remapped);
      }
      const metadata = tx.objectStore("metadata");
      const activeTrainingId = await newestActiveSessionId(() => trainingStore.index("by-updated").openCursor(null, "prev"));
      const activeLearningId = await newestActiveSessionId(() => learningStore.index("by-updated").openCursor(null, "prev"));
      if (activeTrainingId) await metadata.put({ key: ACTIVE_TRAINING_SESSION_KEY, value: activeTrainingId });
      else await metadata.delete(ACTIVE_TRAINING_SESSION_KEY);
      if (activeLearningId) await metadata.put({ key: ACTIVE_LEARNING_SESSION_KEY, value: activeLearningId });
      else await metadata.delete(ACTIVE_LEARNING_SESSION_KEY);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
  async listDuePhrases(now = new Date()) {
    const items = await (await this.db()).getAllFromIndex("phrases", "by-due", IDBKeyRange.upperBound(now.toISOString()));
    return items.sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
  }
  async submitReview(id: string, result: ReviewResult, now = new Date(), operationId?: string) {
    const db = await this.db();
    const tx = db.transaction(["phrases", "reviewLogs", "phraseLearningState"], "readwrite");
    try {
      if (operationId !== undefined) {
        if (!operationId.trim()) throw new Error("复习操作ID无效");
        const existing = await tx.objectStore("reviewLogs").get(operationId);
        if (existing) {
          if (existing.phraseId !== id || existing.result !== result) throw new Error("复习操作ID冲突");
          await tx.done;
          return;
        }
      }
      const phrase = await tx.objectStore("phrases").get(id);
      if (!phrase) throw new Error("找不到这条语言块");
      const stateStore = tx.objectStore("phraseLearningState");
      const currentState = await stateStore.get(id);
      if (currentState?.stage !== "learned" && currentState?.stage !== "mastered") {
        throw new Error("这句话尚未完成新句学习，不能进入复习");
      }
      const scheduled = scheduleReview(phrase, result, now);
      if (operationId) scheduled.log.id = operationId;
      await tx.objectStore("phrases").put(scheduled.phrase);
      await tx.objectStore("reviewLogs").put(scheduled.log);
      const nextState = reviewedState(currentState, phrase.id, result, now);
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
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
  async listCategories() { return (await (await this.db()).getAll("categories")).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async saveCategory(category: Category) { await (await this.db()).put("categories", category); }
  async deleteCategoryAndMigrate(id: string, targetId: string) {
    if (id === targetId) throw new Error("请选择其他分类");
    const db = await this.db();
    const tx = db.transaction(["phrases", "categories", "learningSessions"], "readwrite");
    try {
      if (!await tx.objectStore("categories").get(targetId)) throw new Error("找不到目标分类");
      const timestamp = new Date().toISOString();
      const phrases = await tx.objectStore("phrases").index("by-category").getAll(id);
      for (const phrase of phrases) await tx.objectStore("phrases").put({ ...phrase, categoryId: targetId, updatedAt: timestamp });
      const sessionStore = tx.objectStore("learningSessions");
      for (const session of await sessionStore.getAll()) {
        if (session.themeCategoryId !== id) continue;
        const migrated = { ...session, themeCategoryId: targetId, updatedAt: timestamp };
        assertValidLearningSession(migrated);
        await sessionStore.put(migrated);
      }
      await tx.objectStore("categories").delete(id);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
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
  async saveTrainingSession(session: TrainingSessionRecord) {
    const db = await this.db();
    const tx = db.transaction(["trainingSessions", "metadata"], "readwrite");
    const store = tx.objectStore("trainingSessions");
    await store.put(session);
    const activeId = await newestActiveSessionId(() => store.index("by-updated").openCursor(null, "prev"));
    if (activeId) await tx.objectStore("metadata").put({ key: ACTIVE_TRAINING_SESSION_KEY, value: activeId });
    else await tx.objectStore("metadata").delete(ACTIVE_TRAINING_SESSION_KEY);
    await tx.done;
  }
  async listTrainingSessions(from?: Date, to?: Date) {
    const range = from && to
      ? IDBKeyRange.bound(from.toISOString(), to.toISOString())
      : from
        ? IDBKeyRange.lowerBound(from.toISOString())
        : to
          ? IDBKeyRange.upperBound(to.toISOString())
          : undefined;
    return (await this.db()).getAllFromIndex("trainingSessions", "by-updated", range);
  }
  async getActiveTrainingSession() {
    const db = await this.db();
    const pointer = await db.get("metadata", ACTIVE_TRAINING_SESSION_KEY);
    if (!pointer) return undefined;
    const session = await db.get("trainingSessions", pointer.value);
    return session && !session.completedAt ? session : undefined;
  }
  async completeTrainingSession(id: string, completedAt: Date) {
    const db = await this.db();
    const tx = db.transaction(["trainingSessions", "metadata"], "readwrite");
    const store = tx.objectStore("trainingSessions");
    const session = await store.get(id);
    if (!session) throw new Error("找不到训练会话");
    const timestamp = completedAt.toISOString();
    await store.put({ ...session, completedAt: timestamp, updatedAt: timestamp });
    const activeId = await newestActiveSessionId(() => store.index("by-updated").openCursor(null, "prev"));
    if (activeId) await tx.objectStore("metadata").put({ key: ACTIVE_TRAINING_SESSION_KEY, value: activeId });
    else await tx.objectStore("metadata").delete(ACTIVE_TRAINING_SESSION_KEY);
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
    const nextState = reviewedState(currentState, phrase.id, event.result, reviewTime);
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
  async getAppPreferences(): Promise<AppPreferences> {
    const fallback = { dailyMasteryGoal: DEFAULT_DAILY_MASTERY_GOAL };
    const item = await (await this.db()).get("metadata", "appPreferences");
    if (!item) return fallback;
    try {
      const value = JSON.parse(item.value) as Partial<AppPreferences>;
      return Number.isInteger(value.dailyMasteryGoal) && (value.dailyMasteryGoal ?? 0) > 0 ? value as AppPreferences : fallback;
    } catch { return fallback; }
  }
  async saveAppPreferences(preferences: AppPreferences) {
    if (!Number.isInteger(preferences.dailyMasteryGoal) || preferences.dailyMasteryGoal <= 0) throw new Error("每日掌握目标必须是正整数");
    await (await this.db()).put("metadata", { key: "appPreferences", value: JSON.stringify(preferences) });
  }
  async listPhraseLearningStates() { return (await this.db()).getAll("phraseLearningState"); }
  async getPhraseLearningState(id: string) { return (await this.db()).get("phraseLearningState", id); }
  async savePhraseLearningState(state: PhraseLearningState) { await (await this.db()).put("phraseLearningState", state); }
  async saveLearningSession(session: LearningSessionRecord) {
    const db = await this.db();
    const tx = db.transaction(["learningSessions", "phrases", "categories", "metadata"], "readwrite");
    try {
      const store = tx.objectStore("learningSessions");
      const [sessions, phraseKeys, categoryKeys] = await Promise.all([
        store.getAll(),
        tx.objectStore("phrases").getAllKeys(),
        tx.objectStore("categories").getAllKeys(),
      ]);
      assertValidLearningSession(session, {
        phraseIds: new Set(phraseKeys.map(String)),
        categoryIds: new Set(categoryKeys.map(String)),
      });
      const current = sessions.find(({ id }) => id === session.id);
      assertLearningSessionSave(current, session);
      const otherActive = sessions.filter((existing) => existing.id !== session.id && !existing.completedAt);
      const resultingActiveCount = otherActive.length + (session.completedAt ? 0 : 1);
      if (resultingActiveCount > 1) throw new Error("已有进行中的学习会话");
      await store.put(session);
      const activeId = await newestActiveSessionId(() => store.index("by-updated").openCursor(null, "prev"));
      if (activeId) await tx.objectStore("metadata").put({ key: ACTIVE_LEARNING_SESSION_KEY, value: activeId });
      else await tx.objectStore("metadata").delete(ACTIVE_LEARNING_SESSION_KEY);
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
  async getActiveLearningSession() {
    const db = await this.db();
    const pointer = await db.get("metadata", ACTIVE_LEARNING_SESSION_KEY);
    if (!pointer) return undefined;
    const session = await db.get("learningSessions", pointer.value);
    return session && !session.completedAt ? session : undefined;
  }
  async completeLearningSession(id: string, completedAt: Date) {
    const db = await this.db();
    const tx = db.transaction(["learningSessions", "metadata"], "readwrite");
    const store = tx.objectStore("learningSessions");
    const session = await store.get(id);
    if (!session) throw new Error("找不到学习会话");
    if (session.phase !== "test" || session.studyIndex !== session.phraseIds.length || session.testIndex !== session.phraseIds.length) {
      throw new Error("学习会话尚未完成");
    }
    const timestamp = completedAt.toISOString();
    const completed = { ...session, completedAt: timestamp, updatedAt: timestamp };
    assertValidLearningSession(completed);
    assertMonotonicLearningSession(session, completed);
    await store.put(completed);
    const activeId = await newestActiveSessionId(() => store.index("by-updated").openCursor(null, "prev"));
    if (activeId) await tx.objectStore("metadata").put({ key: ACTIVE_LEARNING_SESSION_KEY, value: activeId });
    else await tx.objectStore("metadata").delete(ACTIVE_LEARNING_SESSION_KEY);
    await tx.done;
  }
  async submitFirstLearningReview(event: TrainingEvent, nextSession: LearningSessionRecord) {
    const db = await this.db();
    const tx = db.transaction(["trainingEvents", "phrases", "reviewLogs", "phraseLearningState", "learningSessions", "metadata"], "readwrite");
    try {
      assertValidLearningSession(nextSession);
      const eventStore = tx.objectStore("trainingEvents");
      const phraseStore = tx.objectStore("phrases");
      const sessionStore = tx.objectStore("learningSessions");
      const stateStore = tx.objectStore("phraseLearningState");
      const storedEvent = await eventStore.get(event.id);
      if (storedEvent) {
        if (!sameTrainingEvent(storedEvent, event)) throw new Error("首次测试事件ID冲突");
        const [phrase, session, state, logs] = await Promise.all([
          phraseStore.get(event.phraseId),
          sessionStore.get(event.sessionId),
          stateStore.get(event.phraseId),
          tx.objectStore("reviewLogs").index("by-phrase").getAll(event.phraseId),
        ]);
        if (session) assertSameLearningSessionIdentity(session, nextSession);
        const nextPositionMatches = nextSession.phase === "test" && nextSession.testIndex > 0
          && nextSession.phraseIds[nextSession.testIndex - 1] === event.phraseId;
        const stateRecorded = (state?.stage === "learned" || state?.stage === "mastered")
          && state.firstTestedAt === event.occurredAt && state.firstResult === event.result;
        const scheduleRecorded = phrase?.lastReviewedAt !== undefined && phrase.lastReviewedAt >= event.occurredAt
          && logs.some((log) => log.reviewedAt === event.occurredAt && log.result === event.result);
        if (!session || !nextPositionMatches || !stateRecorded || !scheduleRecorded) throw new Error("首次测试记录状态不一致");
        if (session.phase === "test" && session.testIndex >= nextSession.testIndex) {
          await tx.done;
          return;
        }
        const canCatchUp = session.phase === "test" && session.testIndex + 1 === nextSession.testIndex
          && session.phraseIds[session.testIndex] === event.phraseId;
        if (!canCatchUp) throw new Error("首次测试记录状态不一致");
        assertMonotonicLearningSession(session, nextSession);
        await sessionStore.put(nextSession);
        await tx.objectStore("metadata").put({ key: ACTIVE_LEARNING_SESSION_KEY, value: nextSession.id });
        await tx.done;
        return;
      }
      const phrase = await phraseStore.get(event.phraseId);
      const session = await sessionStore.get(event.sessionId);
      if (session) assertMonotonicLearningSession(session, nextSession);
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
      const eventDate = shanghaiDate(reviewTime);
      const currentState = await stateStore.get(phrase.id);
      const currentFirstTested = currentState?.firstTestedAt ? new Date(currentState.firstTestedAt) : undefined;
      if (!currentFirstTested || Number.isNaN(currentFirstTested.getTime())) {
        const states = await stateStore.getAll();
        const testedToday = new Set(states.flatMap((state) => {
          if (!state.firstTestedAt || state.phraseId === phrase.id) return [];
          const testedAt = new Date(state.firstTestedAt);
          if (Number.isNaN(testedAt.getTime()) || shanghaiDate(testedAt) !== eventDate) return [];
          return [state.phraseId];
        }));
        if (testedToday.size >= DAILY_NEW_PHRASE_LIMIT) throw new Error("今日学习新句已达到15句上限");
      }
      const scheduled = scheduleReview(phrase, event.result, reviewTime);
      await phraseStore.put(scheduled.phrase);
      await tx.objectStore("reviewLogs").put(scheduled.log);
      const nextState = reviewedState(currentState, phrase.id, event.result, reviewTime);
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
      await tx.objectStore("metadata").put({ key: ACTIVE_LEARNING_SESSION_KEY, value: nextSession.id });
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
  async exportSnapshot(): Promise<BackupEnvelopeV5> {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions", "phraseLearningState", "learningSessions", "metadata"]);
    const [categories, phrases, reviewLogs, trainingEvents, trainingSessions, phraseLearningStates, learningSessions, activeVersion, appPreferences] = await Promise.all([
      tx.objectStore("categories").getAll(),
      tx.objectStore("phrases").getAll(),
      tx.objectStore("reviewLogs").getAll(),
      tx.objectStore("trainingEvents").getAll(),
      tx.objectStore("trainingSessions").getAll(),
      tx.objectStore("phraseLearningState").getAll(),
      tx.objectStore("learningSessions").getAll(),
      tx.objectStore("metadata").get("activeSystemContentVersion"),
      this.getAppPreferences(),
    ]);
    await tx.done;
    return { format: "personal-phrase-bank", version: 5, exportedAt: new Date().toISOString(), categories, phrases, reviewLogs, trainingEvents, trainingSessions, phraseLearningStates, activeSystemContentVersion: activeVersion?.value, learningSessions, appPreferences };
  }

  async importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite") {
    const db = await this.db();
    const normalized = normalizeLegacyBackup(snapshot);
    const stores = ["categories", "phrases", "reviewLogs", "trainingEvents", "trainingSessions", "phraseLearningState", "learningSessions", "metadata"] as const;
    const tx = db.transaction(stores, "readwrite");
    try {
      const [existingCategories, existingPhrases, existingLearningSessions] = await Promise.all([
        tx.objectStore("categories").getAllKeys(),
        tx.objectStore("phrases").getAllKeys(),
        tx.objectStore("learningSessions").getAll(),
      ]);
      const references = {
        categoryIds: new Set([...existingCategories.map(String), ...normalized.categories.map(({ id }) => id)]),
        phraseIds: new Set([...existingPhrases.map(String), ...normalized.phrases.map(({ id }) => id)]),
      };
      const finalLearningSessions = new Map(existingLearningSessions.map((session) => [session.id, session]));
      for (const incoming of normalized.learningSessions) {
        assertValidLearningSession(incoming, references);
        const current = finalLearningSessions.get(incoming.id);
        if (current && policy === "skip") continue;
        if (current) assertMonotonicLearningSession(current, incoming);
        finalLearningSessions.set(incoming.id, incoming);
      }
      for (const session of finalLearningSessions.values()) assertValidLearningSession(session, references);
      if ([...finalLearningSessions.values()].filter(({ completedAt }) => completedAt === undefined).length > 1) {
        throw new Error("已有进行中的学习会话，无法导入");
      }

      const put = async <S extends typeof stores[number]>(store: S, records: PhraseBankDb[S]["value"][]) => {
        for (const record of records) {
          const recordKey = "phraseId" in record && store === "phraseLearningState" ? record.phraseId : "id" in record ? record.id : undefined;
          if (policy === "skip" && recordKey !== undefined && await tx.objectStore(store).get(recordKey)) continue;
          await tx.objectStore(store).put(record as never);
        }
      };
      await put("categories", normalized.categories);
      await put("phrases", normalized.phrases);
      await put("reviewLogs", normalized.reviewLogs);
      await put("trainingEvents", normalized.trainingEvents);
      await put("trainingSessions", normalized.trainingSessions);
      await put("phraseLearningState", normalized.phraseLearningStates);
      await put("learningSessions", normalized.learningSessions);
      const activeTrainingId = await newestActiveSessionId(() => tx.objectStore("trainingSessions").index("by-updated").openCursor(null, "prev"));
      const activeLearningId = await newestActiveSessionId(() => tx.objectStore("learningSessions").index("by-updated").openCursor(null, "prev"));
      if (activeTrainingId) await tx.objectStore("metadata").put({ key: ACTIVE_TRAINING_SESSION_KEY, value: activeTrainingId });
      else await tx.objectStore("metadata").delete(ACTIVE_TRAINING_SESSION_KEY);
      if (activeLearningId) await tx.objectStore("metadata").put({ key: ACTIVE_LEARNING_SESSION_KEY, value: activeLearningId });
      else await tx.objectStore("metadata").delete(ACTIVE_LEARNING_SESSION_KEY);
      if (normalized.activeSystemContentVersion) await tx.objectStore("metadata").put({ key: "activeSystemContentVersion", value: normalized.activeSystemContentVersion });
      await tx.objectStore("metadata").put({ key: "appPreferences", value: JSON.stringify(normalized.appPreferences) });
      await tx.done;
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive after a request failure. */ }
      try { await tx.done; } catch { /* Preserve the original error. */ }
      throw error;
    }
  }
}
