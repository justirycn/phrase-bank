import type { BackupEnvelope, Category, Phrase, ReviewResult } from "../domain/types";

export interface PhraseRepository {
  initialize(): Promise<void>;
  listPhrases(): Promise<Phrase[]>;
  getPhrase(id: string): Promise<Phrase | undefined>;
  savePhrase(phrase: Phrase): Promise<void>;
  deletePhrase(id: string): Promise<void>;
  listDuePhrases(now?: Date): Promise<Phrase[]>;
  submitReview(id: string, result: ReviewResult, now?: Date): Promise<void>;
  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;
  deleteCategoryAndMigrate(id: string, targetId: string): Promise<void>;
  exportSnapshot(): Promise<BackupEnvelope>;
}
