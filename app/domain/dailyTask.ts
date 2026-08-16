import type { TrainingEvent } from "./types";

export interface DailyTaskInput {
  dueCount: number;
  activeReview: boolean;
  newCompletedToday: number;
  newGoal: number;
  availableNew: number;
  activeDailyLearning?: boolean;
}

export interface DailyTask {
  stage: "review" | "learning" | "complete";
  remaining: number;
  batchSize: number;
  shortage: number;
  autonomousUnlocked: boolean;
}

export function deriveDailyTask(input: DailyTaskInput): DailyTask {
  const remaining = Math.max(0, input.newGoal - input.newCompletedToday);
  const availableNew = Math.max(0, input.availableNew);
  const batchSize = Math.min(5, remaining, availableNew);
  const shortage = Math.max(0, remaining - availableNew);
  const reviewPending = input.activeReview || input.dueCount > 0;
  const learningPending = input.activeDailyLearning === true || remaining > 0;

  return {
    stage: reviewPending ? "review" : learningPending ? "learning" : "complete",
    remaining,
    batchSize,
    shortage,
    autonomousUnlocked: !reviewPending && !learningPending,
  };
}

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shanghaiDayBounds(date: string): {
  startInclusive: string;
  endExclusive: string;
} {
  const match = dayPattern.exec(date);
  if (!match) throw new Error("Invalid Shanghai calendar date");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utcDay = Date.UTC(year, month - 1, day);
  if (new Date(utcDay).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid Shanghai calendar date");
  }
  const start = utcDay - SHANGHAI_OFFSET_MS;
  return {
    startInclusive: new Date(start).toISOString(),
    endExclusive: new Date(start + DAY_MS).toISOString(),
  };
}

export function countNewPhrasesOnShanghaiDay(events: TrainingEvent[], date: string): number {
  const { startInclusive, endExclusive } = shanghaiDayBounds(date);
  const start = Date.parse(startInclusive);
  const end = Date.parse(endExclusive);
  return new Set(events.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return event.source === "new"
      && Number.isFinite(occurredAt)
      && occurredAt >= start
      && occurredAt < end;
  }).map(({ phraseId }) => phraseId)).size;
}
