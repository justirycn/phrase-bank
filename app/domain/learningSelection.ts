import type { Phrase, PhraseLearningState } from "./types";

export interface LearningSelectionOptions {
  date: string;
  themeCategoryId: string;
  target: number;
  reservedPhraseIds?: ReadonlySet<string>;
}

export const AUTONOMOUS_LEARNING_GROUP_SIZE = 5;

export interface LearningGroupPreview {
  themeCategoryId?: string;
  phrases: Phrase[];
}

function dateRotationIndex(date: string, length: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) % length;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableOrder(phrases: Phrase[], date: string): Phrase[] {
  return [...phrases].sort((left, right) => {
    const difference = stableHash(`${date}${left.id}`) - stableHash(`${date}${right.id}`);
    return difference || left.id.localeCompare(right.id);
  });
}

function isPersonal(phrase: Phrase): boolean {
  return (phrase.origin ?? "personal") === "personal";
}

function unique(phrases: Phrase[]): Phrase[] {
  return [...new Map(phrases.map((phrase) => [phrase.id, phrase])).values()];
}

export function selectLearningGroup(
  phrases: Phrase[],
  states: PhraseLearningState[],
  options: LearningSelectionOptions,
): Phrase[] {
  const stateById = new Map(states.map((state) => [state.phraseId, state]));
  const eligible = phrases.filter((phrase) => {
    const personalStandalone = (phrase.origin ?? "personal") === "personal"
      && (phrase.kind ?? "standalone") === "standalone";
    const systemCore = phrase.origin === "system" && phrase.kind === "core";
    return !phrase.retiredAt && (personalStandalone || systemCore);
  }).filter((phrase) =>
    (stateById.get(phrase.id)?.stage ?? "unseen") === "unseen"
    && !options.reservedPhraseIds?.has(phrase.id)
  );
  const personal = eligible
    .filter(isPersonal)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  const themed = stableOrder(
    eligible.filter((phrase) => !isPersonal(phrase) && phrase.categoryId === options.themeCategoryId),
    options.date,
  );
  const fallback = stableOrder(
    eligible.filter((phrase) => !isPersonal(phrase) && phrase.categoryId !== options.themeCategoryId),
    options.date,
  );
  return unique([...personal, ...themed, ...fallback]).slice(0, Math.max(0, options.target));
}

export function previewLearningGroup(
  phrases: Phrase[],
  states: PhraseLearningState[],
  categoryIds: readonly string[],
  options: { date: string },
): LearningGroupPreview {
  const validCategories = new Set(categoryIds);
  const stateById = new Map(states.map((state) => [state.phraseId, state]));
  const unseen = (phrase: Phrase) => !phrase.retiredAt
    && (stateById.get(phrase.id)?.stage ?? "unseen") === "unseen"
    && validCategories.has(phrase.categoryId);
  const systemThemes = [...new Set(phrases.filter((phrase) => phrase.origin === "system" && phrase.kind === "core" && unseen(phrase)).map((phrase) => phrase.categoryId))].sort();
  const personal = phrases.filter((phrase) => (phrase.origin ?? "personal") === "personal" && (phrase.kind ?? "standalone") === "standalone" && unseen(phrase))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  const themeCategoryId = systemThemes.length > 0
    ? systemThemes[dateRotationIndex(options.date, systemThemes.length)]
    : personal[0]?.categoryId;
  if (!themeCategoryId) return { themeCategoryId, phrases: [] };
  return {
    themeCategoryId,
    phrases: selectLearningGroup(phrases, states, { date: options.date, themeCategoryId, target: AUTONOMOUS_LEARNING_GROUP_SIZE }),
  };
}
