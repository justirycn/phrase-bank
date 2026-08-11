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
  goodTodayIds?: ReadonlySet<string>;
  previousGroupIds?: ReadonlySet<string>;
  rotationCursor?: number;
  personalNewIntroducedToday?: number;
  systemNewIntroducedToday?: number;
  learningStates?: PhraseLearningState[];
  practicedTodayBucketCounts?: { personal: number; due: number; systemNew: number };
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

function oldestReviewedOrder(phrases: Phrase[], seed: string): Phrase[] {
  return [...phrases].sort((left, right) => {
    const reviewedDifference = new Date(left.lastReviewedAt ?? left.createdAt).getTime()
      - new Date(right.lastReviewedAt ?? right.createdAt).getTime();
    if (reviewedDifference) return reviewedDifference;
    const hashDifference = stableHash(`${seed}${left.id}`) - stableHash(`${seed}${right.id}`);
    return hashDifference || left.id.localeCompare(right.id);
  });
}

function rotateOrder(phrases: Phrase[], offset: number): Phrase[] {
  if (phrases.length === 0) return [];
  const normalizedOffset = ((offset % phrases.length) + phrases.length) % phrases.length;
  return [...phrases.slice(normalizedOffset), ...phrases.slice(0, normalizedOffset)];
}

function sourceFor(phrase: Phrase, nowTime: number): Exclude<TrainingSource, "new" | "requeue"> {
  if (new Date(phrase.nextReviewAt).getTime() <= nowTime) return "due";
  if (phrase.masteryLevel <= 2) return "weak";
  return "mature";
}

function isEligibleStage(state: PhraseLearningState | undefined): boolean {
  return state?.stage === "learned" || state?.stage === "mastered";
}

export function selectTrainingGroup(
  phrases: Phrase[],
  options: TrainingSelectionOptions,
): TrainingCandidate[] {
  const target = options.mode === "quick" ? 3 : 10;
  const nowTime = options.now.getTime();
  const orderSeed = `${options.seed}:${options.rotationCursor ?? 0}`;
  const states = new Map((options.learningStates ?? []).map((state) => [state.phraseId, state]));
  const practicedTodayIds = options.practicedTodayIds ?? new Set<string>();
  const goodTodayIds = options.goodTodayIds ?? new Set<string>();
  const previousGroupIds = options.previousGroupIds ?? new Set<string>();
  const eligible = [...new Map(phrases.map((phrase) => [phrase.id, phrase])).values()]
    .filter((phrase) => !phrase.retiredAt)
    .filter((phrase) => isEligibleStage(states.get(phrase.id)))
    .filter((phrase) => phrase.origin !== "system" || phrase.kind !== "example" || Boolean(states.get(phrase.id)?.unlockedAt));
  const unique = eligible
    .filter((phrase) => options.mode !== "quick" || !goodTodayIds.has(phrase.id))
    .filter((phrase) => options.mode !== "quick" || !previousGroupIds.has(phrase.id));
  const selected: TrainingCandidate[] = [];
  const selectedIds = new Set<string>();

  const add = (pool: Phrase[], limit = Number.POSITIVE_INFINITY) => {
    for (const phrase of pool) {
      if (selected.length >= target || limit <= 0) break;
      if (selectedIds.has(phrase.id)) continue;
      selected.push({ phrase, source: sourceFor(phrase, nowTime) });
      selectedIds.add(phrase.id);
      limit -= 1;
    }
  };

  const priorityPools = (pool: Phrase[], matureRotation = 0) => {
    const due = pool.filter((phrase) => sourceFor(phrase, nowTime) === "due");
    const weak = pool.filter((phrase) => sourceFor(phrase, nowTime) === "weak");
    const mature = pool.filter((phrase) => sourceFor(phrase, nowTime) === "mature");
    return {
      due: seededOrder(due, orderSeed),
      weak: seededOrder(weak, orderSeed),
      mature: rotateOrder(oldestReviewedOrder(mature, orderSeed), matureRotation),
    };
  };

  if (options.mode === "quick") {
    const practicedMatureCount = eligible.filter((phrase) => practicedTodayIds.has(phrase.id)
      && sourceFor(phrase, nowTime) === "mature").length;
    const matureRotation = (options.rotationCursor ?? 0) * target - practicedMatureCount;
    const fresh = priorityPools(
      unique.filter((phrase) => !practicedTodayIds.has(phrase.id)),
      matureRotation,
    );
    add(fresh.due);
    add(fresh.weak);
    add(fresh.mature);

    const practiced = priorityPools(
      unique.filter((phrase) => practicedTodayIds.has(phrase.id)),
      matureRotation,
    );
    add(practiced.due);
    add(practiced.weak);
    add(practiced.mature);
    return selected;
  }

  const freshFirst = (pool: Phrase[]) => [
    ...pool.filter((phrase) => !practicedTodayIds.has(phrase.id)),
    ...pool.filter((phrase) => practicedTodayIds.has(phrase.id)),
  ];
  const personal = priorityPools(unique.filter((phrase) => (phrase.origin ?? "personal") === "personal"));
  add(freshFirst([...personal.due, ...personal.weak, ...personal.mature]), 5);

  const remaining = priorityPools(unique.filter((phrase) => !selectedIds.has(phrase.id)));
  add(freshFirst(remaining.due), 3);
  add(freshFirst(remaining.weak), 1);
  add(freshFirst(remaining.mature), 1);
  add(freshFirst([...remaining.due, ...remaining.weak, ...remaining.mature]));
  return selected;
}
