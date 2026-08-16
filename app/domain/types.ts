export type ReviewResult = "again" | "hard" | "good";
export type TrainingMode = "quick" | "standard";
export type TrainingSource = "due" | "weak" | "mature" | "new" | "requeue";
export type PhraseOrigin = "personal" | "system";
export type PhraseKind = "standalone" | "core" | "example";
export type CefrLevel = "A2" | "B1" | "B2";
export type LearningStage = "unseen" | "learning" | "learned" | "mastered";
export type LearningPhase = "study" | "test";
export type LearningSessionPurpose = "daily" | "autonomous";

export interface TrainingEvent {
  id: string;
  sessionId: string;
  phraseId: string;
  source: TrainingSource;
  result: ReviewResult;
  usedPronunciationHint: boolean;
  recorded: boolean;
  activeSeconds: number;
  occurredAt: string;
}

export interface TrainingSessionRecord {
  id: string;
  mode: TrainingMode;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  phraseIds: string[];
  sources?: TrainingSource[];
  currentIndex: number;
  activeSeconds: number;
}

export interface SpeechPreferences {
  accent: "en-US" | "en-GB";
  autoSpeak: boolean;
}

export interface AppPreferences {
  dailyMasteryGoal: number;
  dailyNewPhraseGoal: number;
}

export const DEFAULT_DAILY_MASTERY_GOAL = 10;
export const DEFAULT_DAILY_NEW_PHRASE_GOAL = 10;

export interface DailyTrainingSummary {
  date: string;
  activeSeconds: number;
  completedGroups: number;
  spokenCount: number;
  masteredCount: number;
  promotedCount: number;
  lightDayUsed: boolean;
}

export interface PhraseInput {
  english: string;
  chinese: string;
  categoryId: string;
  personalExample?: string;
  sourceNote?: string;
}

export interface Phrase extends PhraseInput {
  id: string;
  reviewStep: number;
  masteryLevel: number;
  nextReviewAt: string;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string;
  origin?: PhraseOrigin;
  kind?: PhraseKind;
  parentPhraseId?: string;
  unlockOrder?: number;
  subcategory?: string;
  cefrLevel?: CefrLevel;
  intent?: string;
  contentVersion?: string;
  qualityVersion?: string;
  retiredAt?: string;
}

export interface PhraseLearningState {
  phraseId: string;
  stage: LearningStage;
  firstSeenAt?: string;
  firstTestedAt?: string;
  firstResult?: ReviewResult;
  consecutiveGood: number;
  masteredDates: string[];
  masteryResetAt?: string;
  unlockedAt?: string;
  updatedAt: string;
}

export interface LearningSessionRecord {
  id: string;
  purpose: LearningSessionPurpose;
  date: string;
  themeCategoryId: string;
  phraseIds: string[];
  studyIndex: number;
  testIndex: number;
  phase: LearningPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface SystemContentPhrase extends PhraseInput {
  id: string;
  origin: "system";
  kind: "core" | "example";
  parentPhraseId?: string;
  unlockOrder?: number;
  subcategory: string;
  cefrLevel: CefrLevel;
  intent: string;
  contentVersion: string;
  qualityVersion: string;
}

export interface SystemContentPackage {
  format: "phrase-bank-system-content";
  version: string;
  generatedAt: string;
  qualityVersion: string;
  phrases: SystemContentPhrase[];
}

export interface Category {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLog {
  id: string;
  phraseId: string;
  result: ReviewResult;
  reviewedAt: string;
  previousStep: number;
  nextReviewAt: string;
}

export interface BackupEnvelopeV1 {
  format: "personal-phrase-bank";
  version: 1;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
}

export interface BackupEnvelopeV2 {
  format: "personal-phrase-bank";
  version: 2;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
  trainingEvents: TrainingEvent[];
  trainingSessions: TrainingSessionRecord[];
}

export interface BackupEnvelopeV3 {
  format: "personal-phrase-bank";
  version: 3;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
  trainingEvents: TrainingEvent[];
  trainingSessions: TrainingSessionRecord[];
  phraseLearningStates: PhraseLearningState[];
  activeSystemContentVersion?: string;
}

export interface BackupEnvelopeV4 {
  format: "personal-phrase-bank";
  version: 4;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
  trainingEvents: TrainingEvent[];
  trainingSessions: TrainingSessionRecord[];
  phraseLearningStates: PhraseLearningState[];
  activeSystemContentVersion?: string;
  learningSessions: LearningSessionRecord[];
}

export interface BackupEnvelopeV5 {
  format: "personal-phrase-bank";
  version: 5;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
  trainingEvents: TrainingEvent[];
  trainingSessions: TrainingSessionRecord[];
  phraseLearningStates: PhraseLearningState[];
  activeSystemContentVersion?: string;
  learningSessions: LearningSessionRecord[];
  appPreferences: AppPreferences;
}

export type BackupEnvelope = BackupEnvelopeV1 | BackupEnvelopeV2 | BackupEnvelopeV3 | BackupEnvelopeV4 | BackupEnvelopeV5;
