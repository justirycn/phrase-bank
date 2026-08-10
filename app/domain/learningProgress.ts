import type { Phrase, PhraseLearningState, ReviewResult } from "./types";

const shanghaiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

export function applyLearningResult(
  state: PhraseLearningState,
  result: ReviewResult,
  now: Date,
): PhraseLearningState {
  if (result !== "good") return state;
  const day = shanghaiDay.format(now);
  const masteredDates = state.masteredDates.includes(day) ? state.masteredDates : [...state.masteredDates, day].sort();
  return { ...state, masteredDates, updatedAt: now.toISOString() };
}

export function nextExampleToUnlock(
  reviewed: Phrase,
  examples: Phrase[],
  states: PhraseLearningState[],
): Phrase | undefined {
  const reviewedState = states.find(({ phraseId }) => phraseId === reviewed.id);
  if (!reviewedState || reviewedState.masteredDates.length < 2 || reviewed.origin !== "system") return undefined;
  const ordered = examples
    .filter(({ kind, parentPhraseId, retiredAt }) => kind === "example" && parentPhraseId === (reviewed.kind === "core" ? reviewed.id : reviewed.parentPhraseId) && !retiredAt)
    .sort((left, right) => (left.unlockOrder ?? 0) - (right.unlockOrder ?? 0));
  const targetOrder = reviewed.kind === "core" ? 1 : (reviewed.unlockOrder ?? 0) + 1;
  const target = ordered.find(({ unlockOrder }) => unlockOrder === targetOrder);
  if (!target || states.find(({ phraseId }) => phraseId === target.id)?.unlockedAt) return undefined;
  return target;
}
