import type { BackupEnvelope, BackupEnvelopeV2, Category, Phrase, ReviewResult, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../domain/types";

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
  saveTrainingEvent(event: TrainingEvent): Promise<void>;
  listTrainingEvents(from?: Date, to?: Date): Promise<TrainingEvent[]>;
  saveTrainingSession(session: TrainingSessionRecord): Promise<void>;
  getActiveTrainingSession(): Promise<TrainingSessionRecord | undefined>;
  completeTrainingSession(id: string, completedAt: Date): Promise<void>;
  getSpeechPreferences(): Promise<SpeechPreferences>;
  saveSpeechPreferences(preferences: SpeechPreferences): Promise<void>;
  exportSnapshot(): Promise<BackupEnvelopeV2>;
  importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite"): Promise<void>;
}
