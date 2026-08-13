import type { Phrase, PhraseLearningState, ReviewResult } from "./types";

const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

function validCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);
}

function resetDay(state: PhraseLearningState): string | undefined {
  if (!state.masteryResetAt) return undefined;
  const resetAt = new Date(state.masteryResetAt);
  return Number.isNaN(resetAt.getTime()) ? undefined : shanghaiDay.format(resetAt);
}

export function effectiveMasteryDates(state: PhraseLearningState): string[] {
  const cutoff = resetDay(state);
  return [...new Set(state.masteredDates.filter((day) => validCalendarDay(day) && (!cutoff || day > cutoff)))].sort();
}

export function masteryAchievedDate(state: PhraseLearningState): string | undefined {
  return effectiveMasteryDates(state)[2];
}

export function applyLearningResult(
  state: PhraseLearningState,
  result: ReviewResult,
  now: Date,
): PhraseLearningState {
  const timestamp = now.toISOString();
  if (result !== "good") {
    return {
      ...state,
      stage: "learned",
      consecutiveGood: 0,
      masteryResetAt: timestamp,
      updatedAt: timestamp,
    };
  }
  const day = shanghaiDay.format(now);
  const masteredDates = [...new Set([...state.masteredDates.filter(validCalendarDay), day])].sort();
  const progressed = { ...state, masteredDates };
  const effectiveDates = effectiveMasteryDates(progressed);
  return {
    ...progressed,
    stage: effectiveDates.length >= 3 ? "mastered" : "learned",
    consecutiveGood: effectiveDates.length,
    updatedAt: timestamp,
  };
}

export function nextExampleToUnlock(
  reviewed: Phrase,
  examples: Phrase[],
  states: PhraseLearningState[],
): Phrase | undefined {
  const reviewedState = states.find(({ phraseId }) => phraseId === reviewed.id);
  if (!reviewedState || !masteryAchievedDate(reviewedState) || reviewed.origin !== "system") return undefined;
  const ordered = examples
    .filter(({ kind, parentPhraseId, retiredAt }) => kind === "example" && parentPhraseId === (reviewed.kind === "core" ? reviewed.id : reviewed.parentPhraseId) && !retiredAt)
    .sort((left, right) => (left.unlockOrder ?? 0) - (right.unlockOrder ?? 0));
  const targetOrder = reviewed.kind === "core" ? 1 : (reviewed.unlockOrder ?? 0) + 1;
  const target = ordered.find(({ unlockOrder }) => unlockOrder === targetOrder);
  if (!target || states.find(({ phraseId }) => phraseId === target.id)?.unlockedAt) return undefined;
  return target;
}
