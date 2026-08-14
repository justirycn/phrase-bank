import type { Phrase, PhraseInput, ReviewLog, ReviewResult } from "./types";
import { personalPhraseDefaults } from "./systemContent";

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60] as const;

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isReviewDueOnShanghaiDay(nextReviewAt: string, now: Date): boolean {
  if (!isoInstant.test(nextReviewAt)) return false;
  const due = new Date(nextReviewAt);
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) return false;
  return shanghaiDay.format(due) <= shanghaiDay.format(now);
}

export function shanghaiDayEndIso(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("复习日期无效");
  const [year, month, day] = shanghaiDay.format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999)).toISOString();
}

export function createNewPhrase(input: PhraseInput, now = new Date()): Phrase {
  const timestamp = now.toISOString();
  return {
    ...input,
    ...personalPhraseDefaults(),
    english: input.english.trim(),
    chinese: input.chinese.trim(),
    personalExample: input.personalExample?.trim() ?? "",
    sourceNote: input.sourceNote?.trim() ?? "",
    id: uid(),
    reviewStep: 0,
    masteryLevel: 0,
    nextReviewAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function scheduleReview(phrase: Phrase, result: ReviewResult, now = new Date()): { phrase: Phrase; log: ReviewLog } {
  const previousStep = phrase.reviewStep;
  let reviewStep = previousStep;
  let due: Date;
  let masteryLevel = phrase.masteryLevel;

  if (result === "again") {
    reviewStep = 0;
    masteryLevel = Math.max(0, masteryLevel - 1);
    due = addDays(now, 1);
  } else if (result === "hard") {
    masteryLevel = Math.max(1, masteryLevel);
    due = addDays(now, 1);
  } else {
    const intervalIndex = Math.min(reviewStep, REVIEW_INTERVAL_DAYS.length - 1);
    due = addDays(now, REVIEW_INTERVAL_DAYS[intervalIndex]);
    reviewStep = Math.min(reviewStep + 1, REVIEW_INTERVAL_DAYS.length);
    masteryLevel = Math.min(3, masteryLevel + 1);
  }

  const nextReviewAt = due.toISOString();
  const updated: Phrase = { ...phrase, reviewStep, masteryLevel, nextReviewAt, lastReviewedAt: now.toISOString(), updatedAt: now.toISOString() };
  return {
    phrase: updated,
    log: { id: uid(), phraseId: phrase.id, result, reviewedAt: now.toISOString(), previousStep, nextReviewAt },
  };
}
