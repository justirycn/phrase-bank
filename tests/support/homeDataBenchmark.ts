import type { BackupEnvelopeV4, Category, Phrase, PhraseLearningState, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";
import { loadHomeData } from "../../app/services/homeData";
import { LocalPhraseRepository } from "../../app/storage/indexedDbRepository";
import type { PhraseRepository } from "../../app/storage/repository";

export const HOME_BENCHMARK_SEED = 20260811;
export const HOME_BENCHMARK_NOW = new Date("2026-08-11T08:00:00.000Z");

function isoDay(daysBefore: number, hour: number) {
  const value = new Date("2026-08-11T00:00:00.000Z");
  value.setUTCDate(value.getUTCDate() - daysBefore);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

export function makeHomeBenchmarkFixture(): BackupEnvelopeV4 {
  const categories: Category[] = Array.from({ length: 10 }, (_, index) => ({
    id: `category-${index}`, name: `Category ${index}`, isDefault: index === 0,
    createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
  }));
  const phrases: Phrase[] = Array.from({ length: 2_000 }, (_, index) => ({
    id: `fixture-phrase-${index.toString().padStart(4, "0")}`,
    english: `Deterministic phrase ${index}`,
    chinese: `固定短句 ${index}`,
    categoryId: categories[index % categories.length].id,
    origin: index % 5 === 0 ? "personal" : "system",
    kind: index % 5 === 0 ? "standalone" : "core",
    reviewStep: index % 4,
    masteryLevel: index % 4,
    nextReviewAt: isoDay(index % 30, 1),
    createdAt: isoDay(119 - (index % 120), 2),
    updatedAt: isoDay(index % 30, 3),
  }));
  const phraseLearningStates: PhraseLearningState[] = phrases.map((phrase, index) => ({
    phraseId: phrase.id,
    stage: index % 9 === 0 ? "mastered" : index % 7 === 0 ? "unseen" : "learned",
    consecutiveGood: index % 5,
    masteredDates: index % 9 === 0 ? ["2026-08-10"] : [],
    updatedAt: phrase.updatedAt,
  }));
  const trainingEvents: TrainingEvent[] = [];
  const trainingSessions: TrainingSessionRecord[] = [];
  for (let day = 0; day < 120; day += 1) {
    for (let index = 0; index < 84; index += 1) trainingEvents.push({
      id: `event-${day}-${index}`, sessionId: `session-${day}-${index % 12}`,
      phraseId: phrases[(day * 84 + index + HOME_BENCHMARK_SEED) % phrases.length].id,
      source: index % 3 === 0 ? "due" : "quick", result: index % 7 === 0 ? "hard" : "good",
      usedPronunciationHint: index % 4 === 0, recorded: false, activeSeconds: 8 + index % 30,
      occurredAt: isoDay(day, 4 + index % 16),
    });
    for (let index = 0; index < 12; index += 1) trainingSessions.push({
      id: `session-${day}-${index}`, mode: index % 2 === 0 ? "quick" : "due",
      startedAt: isoDay(day, 4 + index), updatedAt: isoDay(day, 4 + index),
      completedAt: isoDay(day, 4 + index), phraseIds: [phrases[(day * 12 + index) % phrases.length].id],
      currentIndex: 1, activeSeconds: 60,
    });
  }
  return {
    format: "personal-phrase-bank", version: 4, exportedAt: HOME_BENCHMARK_NOW.toISOString(),
    categories, phrases, reviewLogs: [], trainingEvents, trainingSessions,
    phraseLearningStates, learningSessions: [],
  };
}

export async function runHomeDataBenchmark() {
  const fixture = makeHomeBenchmarkFixture();
  const base = new LocalPhraseRepository(`home-benchmark-${crypto.randomUUID()}`);
  await base.initialize();
  await base.importSnapshot(fixture, "overwrite");
  const names = ["listPhrases", "listCategories", "listDuePhrases", "listTrainingEvents", "listTrainingSessions", "listPhraseLearningStates", "getActiveTrainingSession", "getActiveLearningSession", "exportSnapshot"] as const;
  const calls = Object.fromEntries(names.map((name) => [name, 0])) as Record<(typeof names)[number], number>;
  const rows = { trainingEvents: 0, trainingSessions: 0, heatmapDays: 0 };
  const repository = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (property in calls) calls[property as keyof typeof calls] += 1;
        const result = await value.apply(target, args);
        if (property === "listTrainingEvents") rows.trainingEvents = result.length;
        if (property === "listTrainingSessions") rows.trainingSessions = result.length;
        return result;
      };
    },
  }) as PhraseRepository;
  const started = performance.now();
  const data = await loadHomeData(repository, HOME_BENCHMARK_NOW);
  const serviceReadyMilliseconds = performance.now() - started;
  rows.heatmapDays = data.heatmap.length;
  return {
    fixture: {
      seed: HOME_BENCHMARK_SEED, phrases: fixture.phrases.length, categories: fixture.categories.length,
      learningStates: fixture.phraseLearningStates.length, events: fixture.trainingEvents.length,
      trainingSessions: fixture.trainingSessions.length,
    }, calls, rows, serviceReadyMilliseconds,
  };
}
