import type { Phrase, TrainingMode, TrainingSource } from "./types";

export interface TrainingCandidate {
  phrase: Phrase;
  source: TrainingSource;
}

export interface TrainingSelectionOptions {
  mode: TrainingMode;
  now: Date;
  seed: string;
  newIntroducedToday: number;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededOrder(phrases: Phrase[], seed: string): Phrase[] {
  return [...phrases].sort((left, right) => {
    const hashDifference = stableHash(`${seed}${left.id}`) - stableHash(`${seed}${right.id}`);
    return hashDifference || left.id.localeCompare(right.id);
  });
}

export function selectTrainingGroup(
  phrases: Phrase[],
  options: TrainingSelectionOptions,
): TrainingCandidate[] {
  const uniquePhrases = [...new Map(phrases.map((phrase) => [phrase.id, phrase])).values()];
  const reviewed = uniquePhrases.filter((phrase) => phrase.lastReviewedAt !== undefined);
  const newPhrases = uniquePhrases.filter((phrase) => phrase.lastReviewedAt === undefined);
  const nowTime = options.now.getTime();
  const due = reviewed.filter((phrase) => new Date(phrase.nextReviewAt).getTime() <= nowTime);
  const future = reviewed.filter((phrase) => new Date(phrase.nextReviewAt).getTime() > nowTime);
  const weak = future.filter((phrase) => phrase.masteryLevel <= 1);
  const mature = future.filter((phrase) => phrase.masteryLevel === 3);
  const levelTwo = future.filter((phrase) => phrase.masteryLevel === 2);
  const allocation = options.mode === "quick"
    ? { target: 3, due: 2, weak: 1, mature: 0 }
    : { target: 10, due: 6, weak: 2, mature: 2 };
  const selected: TrainingCandidate[] = [];
  const selectedIds = new Set<string>();

  const add = (pool: Phrase[], source: TrainingSource, limit: number) => {
    for (const phrase of seededOrder(pool, options.seed)) {
      if (selected.length >= allocation.target || limit <= 0) break;
      if (selectedIds.has(phrase.id)) continue;
      selected.push({ phrase, source });
      selectedIds.add(phrase.id);
      limit -= 1;
    }
  };

  add(due, "due", allocation.due);
  add(weak, "weak", allocation.weak);
  add(mature, "mature", allocation.mature);

  const reviewedBackfill = [
    ...due.map((phrase) => ({ phrase, source: "due" as const })),
    ...weak.map((phrase) => ({ phrase, source: "weak" as const })),
    ...levelTwo.map((phrase) => ({ phrase, source: "weak" as const })),
    ...mature.map((phrase) => ({ phrase, source: "mature" as const })),
  ].sort((left, right) => {
    const difference = stableHash(`${options.seed}${left.phrase.id}`)
      - stableHash(`${options.seed}${right.phrase.id}`);
    return difference || left.phrase.id.localeCompare(right.phrase.id);
  });

  for (const candidate of reviewedBackfill) {
    if (selected.length >= allocation.target) break;
    if (selectedIds.has(candidate.phrase.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.phrase.id);
  }

  const newAllowance = Math.max(0, 3 - options.newIntroducedToday);
  add(newPhrases, "new", Math.min(newAllowance, allocation.target - selected.length));

  return selected;
}
