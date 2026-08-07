export type ReviewResult = "again" | "hard" | "good";

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

export interface BackupEnvelope {
  format: "personal-phrase-bank";
  version: 1;
  exportedAt: string;
  categories: Category[];
  phrases: Phrase[];
  reviewLogs: ReviewLog[];
}
