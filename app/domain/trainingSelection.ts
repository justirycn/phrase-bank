import type { Phrase, PhraseLearningState, TrainingMode, TrainingSource } from "./types";

export interface TrainingCandidate {
  phrase: Phrase;
  source: TrainingSource;
}

export interface TrainingSelectionOptions {
  mode: TrainingMode;
  now: Date;
  seed: string;
  newIntroducedToday: number;
  practicedTodayIds?: ReadonlySet<string>;
  personalNewIntroducedToday?: number;
  systemNewIntroducedToday?: number;
  learningStates?: PhraseLearningState[];
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
  if (options.personalNewIntroducedToday !== undefined || options.systemNewIntroducedToday !== undefined || options.learningStates !== undefined) {
    return selectPrioritizedGroup(phrases, options);
  }
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
  const practicedTodayIds = options.practicedTodayIds ?? new Set<string>();
  const fresh = (pool: Phrase[]) => pool.filter((phrase) => !practicedTodayIds.has(phrase.id));
  const repeated = (pool: Phrase[]) => pool.filter((phrase) => practicedTodayIds.has(phrase.id));

  const add = (pool: Phrase[], source: TrainingSource, limit: number) => {
    for (const phrase of seededOrder(pool, options.seed)) {
      if (selected.length >= allocation.target || limit <= 0) break;
      if (selectedIds.has(phrase.id)) continue;
      selected.push({ phrase, source });
      selectedIds.add(phrase.id);
      limit -= 1;
    }
  };

  add(fresh(due), "due", allocation.due);
  add(fresh(weak), "weak", allocation.weak);
  add(fresh(mature), "mature", allocation.mature);

  const reviewedBackfill = [
    ...fresh(due).map((phrase) => ({ phrase, source: "due" as const })),
    ...fresh(weak).map((phrase) => ({ phrase, source: "weak" as const })),
    ...fresh(levelTwo).map((phrase) => ({ phrase, source: "weak" as const })),
    ...fresh(mature).map((phrase) => ({ phrase, source: "mature" as const })),
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
  add(fresh(newPhrases), "new", Math.min(newAllowance, allocation.target - selected.length));

  const repeatedBackfill = [
    ...repeated(due).map((phrase) => ({ phrase, source: "due" as const })),
    ...repeated(weak).map((phrase) => ({ phrase, source: "weak" as const })),
    ...repeated(levelTwo).map((phrase) => ({ phrase, source: "weak" as const })),
    ...repeated(mature).map((phrase) => ({ phrase, source: "mature" as const })),
  ].sort((left, right) => {
    const difference = stableHash(`${options.seed}${left.phrase.id}`)
      - stableHash(`${options.seed}${right.phrase.id}`);
    return difference || left.phrase.id.localeCompare(right.phrase.id);
  });

  for (const candidate of repeatedBackfill) {
    if (selected.length >= allocation.target) break;
    if (selectedIds.has(candidate.phrase.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.phrase.id);
  }

  const selectedNewCount = selected.filter(({ source }) => source === "new").length;
  add(
    repeated(newPhrases),
    "new",
    Math.min(Math.max(0, newAllowance - selectedNewCount), allocation.target - selected.length),
  );

  return selected;
}

function selectPrioritizedGroup(phrases: Phrase[], options: TrainingSelectionOptions): TrainingCandidate[] {
  const target = options.mode === "quick" ? 3 : 10;
  const states = new Map((options.learningStates ?? []).map((state) => [state.phraseId, state]));
  const practiced = options.practicedTodayIds ?? new Set<string>();
  const unique = [...new Map(phrases.map((phrase) => [phrase.id, phrase])).values()]
    .filter((phrase) => !phrase.retiredAt)
    .filter((phrase) => phrase.origin !== "system" || phrase.kind !== "example" || Boolean(states.get(phrase.id)?.unlockedAt));
  const nowTime = options.now.getTime();
  const selected: TrainingCandidate[] = [];
  const ids = new Set<string>();
  const sourceFor = (phrase: Phrase): TrainingSource => {
    if (!phrase.lastReviewedAt) return "new";
    if (new Date(phrase.nextReviewAt).getTime() <= nowTime) return "due";
    if (phrase.masteryLevel <= 2) return "weak";
    return "mature";
  };
  const add = (pool: Phrase[], limit = Number.POSITIVE_INFINITY) => {
    const ordered = [...seededOrder(pool.filter((phrase) => !practiced.has(phrase.id)), options.seed), ...seededOrder(pool.filter((phrase) => practiced.has(phrase.id)), options.seed)];
    for (const phrase of ordered) {
      if (selected.length >= target || limit <= 0 || ids.has(phrase.id)) continue;
      selected.push({ phrase, source: sourceFor(phrase) });
      ids.add(phrase.id);
      limit -= 1;
    }
  };
  const isPersonal = (phrase: Phrase) => (phrase.origin ?? "personal") === "personal";
  const due = unique.filter((phrase) => phrase.lastReviewedAt && new Date(phrase.nextReviewAt).getTime() <= nowTime);
  add(due.filter(isPersonal));
  add(due.filter((phrase) => !isPersonal(phrase)));
  add(unique.filter((phrase) => isPersonal(phrase) && phrase.lastReviewedAt && !ids.has(phrase.id) && (states.get(phrase.id)?.masteredDates.length ?? 0) < 2));
  add(unique.filter((phrase) => isPersonal(phrase) && !phrase.lastReviewedAt), Math.max(0, 5 - (options.personalNewIntroducedToday ?? 0)));
  add(unique.filter((phrase) => !isPersonal(phrase) && phrase.lastReviewedAt && !ids.has(phrase.id)));
  add(unique.filter((phrase) => !isPersonal(phrase) && !phrase.lastReviewedAt), Math.max(0, 3 - (options.systemNewIntroducedToday ?? 0)));
  add(unique.filter((phrase) => phrase.lastReviewedAt && !ids.has(phrase.id)));
  return selected;
}
