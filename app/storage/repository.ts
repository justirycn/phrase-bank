import type { AppPreferences, BackupEnvelope, BackupEnvelopeV5, Category, LearningSessionPurpose, LearningSessionRecord, Phrase, PhraseLearningState, ReviewResult, SpeechPreferences, SystemContentPackage, TrainingEvent, TrainingSessionRecord } from "../domain/types";

export interface PhraseRepository {
  initialize(): Promise<void>;
  listPhrases(): Promise<Phrase[]>;
  getPhrase(id: string): Promise<Phrase | undefined>;
  savePhrase(phrase: Phrase): Promise<void>;
  deletePhrase(id: string): Promise<void>;
  listDuePhrases(now?: Date): Promise<Phrase[]>;
  submitReview(id: string, result: ReviewResult, now?: Date, operationId?: string): Promise<void>;
  submitTrainingReview(event: TrainingEvent): Promise<void>;
  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;
  deleteCategoryAndMigrate(id: string, targetId: string): Promise<void>;
  saveTrainingEvent(event: TrainingEvent): Promise<void>;
  listTrainingEvents(from?: Date, to?: Date): Promise<TrainingEvent[]>;
  saveTrainingSession(session: TrainingSessionRecord): Promise<void>;
  listTrainingSessions(from?: Date, to?: Date): Promise<TrainingSessionRecord[]>;
  getActiveTrainingSession(): Promise<TrainingSessionRecord | undefined>;
  completeTrainingSession(id: string, completedAt: Date): Promise<void>;
  getSpeechPreferences(): Promise<SpeechPreferences>;
  saveSpeechPreferences(preferences: SpeechPreferences): Promise<void>;
  getAppPreferences(): Promise<AppPreferences>;
  saveAppPreferences(preferences: AppPreferences): Promise<void>;
  listPhraseLearningStates(): Promise<PhraseLearningState[]>;
  getPhraseLearningState(id: string): Promise<PhraseLearningState | undefined>;
  savePhraseLearningState(state: PhraseLearningState): Promise<void>;
  saveLearningSession(session: LearningSessionRecord): Promise<void>;
  getActiveLearningSession(purpose: LearningSessionPurpose): Promise<LearningSessionRecord | undefined>;
  completeLearningSession(id: string, completedAt: Date): Promise<void>;
  submitFirstLearningReview(event: TrainingEvent, nextSession: LearningSessionRecord): Promise<void>;
  getActiveSystemContentVersion(): Promise<string | undefined>;
  installSystemContentPackage(content: SystemContentPackage): Promise<void>;
  rollbackSystemContentPackage(version: string): Promise<void>;
  exportSnapshot(): Promise<BackupEnvelopeV5>;
  importSnapshot(snapshot: BackupEnvelope, policy: "skip" | "overwrite"): Promise<void>;
}
