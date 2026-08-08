import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupEnvelope, Category, Phrase, ReviewLog, ReviewResult } from "../domain/types";
import { scheduleReview } from "../domain/review";
import { defaultCategories } from "./seed";
import { STARTER_PHRASES } from "./starterPhrases";
import type { PhraseRepository } from "./repository";

interface PhraseBankDb extends DBSchema {
  phrases: { key: string; value: Phrase; indexes: { "by-due": string; "by-created": string; "by-category": string } };
  categories: { key: string; value: Category };
  reviewLogs: { key: string; value: ReviewLog; indexes: { "by-phrase": string } };
  metadata: { key: string; value: { key: string; value: string } };
}

export class LocalPhraseRepository implements PhraseRepository {
  private dbPromise?: Promise<IDBPDatabase<PhraseBankDb>>;
  constructor(private readonly dbName = "personal-phrase-bank") {}

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<PhraseBankDb>(this.dbName, 1, {
        upgrade(db) {
          const phrases = db.createObjectStore("phrases", { keyPath: "id" });
          phrases.createIndex("by-due", "nextReviewAt");
          phrases.createIndex("by-created", "createdAt");
          phrases.createIndex("by-category", "categoryId");
          db.createObjectStore("categories", { keyPath: "id" });
          const logs = db.createObjectStore("reviewLogs", { keyPath: "id" });
          logs.createIndex("by-phrase", "phraseId");
          db.createObjectStore("metadata", { keyPath: "key" });
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
  async exportSnapshot(): Promise<BackupEnvelope> {
    const db = await this.db();
    const [categories, phrases, reviewLogs] = await Promise.all([db.getAll("categories"), db.getAll("phrases"), db.getAll("reviewLogs")]);
    return { format: "personal-phrase-bank", version: 1, exportedAt: new Date().toISOString(), categories, phrases, reviewLogs };
  }

  async importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite") {
    const db = await this.db();
    const tx = db.transaction(["categories", "phrases", "reviewLogs"], "readwrite");
    const put = async <S extends "categories" | "phrases" | "reviewLogs">(store: S, records: PhraseBankDb[S]["value"][]) => {
      for (const record of records) {
        if (policy === "skip" && await tx.objectStore(store).get(record.id)) continue;
        await tx.objectStore(store).put(record as never);
      }
    };
    await put("categories", snapshot.categories);
    await put("phrases", snapshot.phrases);
    await put("reviewLogs", snapshot.reviewLogs);
    await tx.done;
  }
}
