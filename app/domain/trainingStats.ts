import type {
  DailyTrainingSummary,
  TrainingEvent,
  TrainingSessionRecord,
} from "./types";

export interface DailyTrainingResult extends DailyTrainingSummary {
  streakQualified: boolean;
  fullGoalReached: boolean;
}

export interface TrainingStreak {
  current: number;
  lightDaysUsedThisWeek: number;
}

export interface WeeklyTrainingSummary {
  weekStart: string;
  activeSeconds: number;
  completedGroups: number;
  spokenCount: number;
  masteredCount: number;
  promotedCount: number;
  weakPhraseIds: string[];
}

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseCalendarDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return undefined;
  return parsed;
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function shanghaiDate(timestamp: string): string | undefined {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts = shanghaiDateFormatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function promotedEvents(events: TrainingEvent[]): Set<TrainingEvent> {
  const sorted = [...events].sort((left, right) => {
    const timeDifference = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
  const previousByPhrase = new Map<string, TrainingEvent>();
  const promoted = new Set<TrainingEvent>();
  for (const current of sorted) {
    const previous = previousByPhrase.get(current.phraseId);
    if (
      current.result === "good"
      && previous !== undefined
      && (previous.result === "again" || previous.result === "hard")
    ) promoted.add(current);
    previousByPhrase.set(current.phraseId, current);
  }
  return promoted;
}

function zeroDaily(date: string): DailyTrainingResult {
  return {
    date,
    activeSeconds: 0,
    completedGroups: 0,
    spokenCount: 0,
    masteredCount: 0,
    promotedCount: 0,
    lightDayUsed: false,
    streakQualified: false,
    fullGoalReached: false,
  };
}

export function summarizeDailyTraining(
  date: string,
  events: TrainingEvent[],
  sessions: TrainingSessionRecord[],
): DailyTrainingResult {
  if (!parseCalendarDate(date)) return zeroDaily(date);
  const dailyEvents = events.filter((trainingEvent) => shanghaiDate(trainingEvent.occurredAt) === date);
  const promoted = promotedEvents(events);
  const activeSeconds = dailyEvents.reduce((total, trainingEvent) => total + trainingEvent.activeSeconds, 0);
  return {
    date,
    activeSeconds,
    completedGroups: sessions.filter((trainingSession) =>
      trainingSession.completedAt !== undefined
      && shanghaiDate(trainingSession.completedAt) === date).length,
    spokenCount: dailyEvents.filter((trainingEvent) => trainingEvent.recorded).length,
    masteredCount: dailyEvents.filter((trainingEvent) => trainingEvent.result === "good").length,
    promotedCount: dailyEvents.filter((trainingEvent) => promoted.has(trainingEvent)).length,
    lightDayUsed: activeSeconds >= 300 && activeSeconds < 1200,
    streakQualified: activeSeconds >= 1200,
    fullGoalReached: activeSeconds >= 1800,
  };
}

function isoWeekKey(date: Date): string {
  const dayFromMonday = (date.getUTCDay() + 6) % 7;
  return calendarDate(addCalendarDays(date, -dayFromMonday));
}

export function calculateStreak(
  days: DailyTrainingSummary[],
  today: string,
): TrainingStreak {
  const todayDate = parseCalendarDate(today);
  if (!todayDate) return { current: 0, lightDaysUsedThisWeek: 0 };
  const secondsByDate = new Map<string, number>();
  for (const summary of days) {
    if (!parseCalendarDate(summary.date) || summary.date > today) continue;
    secondsByDate.set(summary.date, (secondsByDate.get(summary.date) ?? 0) + summary.activeSeconds);
  }

  const currentWeekStart = isoWeekKey(todayDate);
  const lightDaysUsedThisWeek = [...secondsByDate.entries()].some(([date, activeSeconds]) =>
    date >= currentWeekStart && activeSeconds >= 300 && activeSeconds < 1200) ? 1 : 0;

  const lightWeeks = new Set<string>();
  let current = 0;
  for (let cursor = todayDate; ; cursor = addCalendarDays(cursor, -1)) {
    const activeSeconds = secondsByDate.get(calendarDate(cursor)) ?? 0;
    if (activeSeconds < 300) break;
    if (activeSeconds < 1200) {
      const week = isoWeekKey(cursor);
      if (lightWeeks.has(week)) break;
      lightWeeks.add(week);
    }
    current += 1;
  }
  return {
    current,
    lightDaysUsedThisWeek,
  };
}

function zeroWeek(weekStart: string): WeeklyTrainingSummary {
  return {
    weekStart,
    activeSeconds: 0,
    completedGroups: 0,
    spokenCount: 0,
    masteredCount: 0,
    promotedCount: 0,
    weakPhraseIds: [],
  };
}

export function summarizeWeek(
  events: TrainingEvent[],
  sessions: TrainingSessionRecord[],
  weekStart: string,
): WeeklyTrainingSummary {
  const start = parseCalendarDate(weekStart);
  if (!start) return zeroWeek(weekStart);
  const end = calendarDate(addCalendarDays(start, 6));
  const weeklyEvents = events.filter((trainingEvent) => {
    const date = shanghaiDate(trainingEvent.occurredAt);
    return date !== undefined && date >= weekStart && date <= end;
  });
  const promoted = promotedEvents(events);
  const difficulty = new Map<string, number>();
  for (const trainingEvent of weeklyEvents) {
    const score = trainingEvent.result === "again" ? 2 : trainingEvent.result === "hard" ? 1 : 0;
    difficulty.set(trainingEvent.phraseId, (difficulty.get(trainingEvent.phraseId) ?? 0) + score);
  }

  return {
    weekStart,
    activeSeconds: weeklyEvents.reduce((total, trainingEvent) => total + trainingEvent.activeSeconds, 0),
    completedGroups: sessions.filter((trainingSession) => {
      if (trainingSession.completedAt === undefined) return false;
      const date = shanghaiDate(trainingSession.completedAt);
      return date !== undefined && date >= weekStart && date <= end;
    }).length,
    spokenCount: weeklyEvents.filter((trainingEvent) => trainingEvent.recorded).length,
    masteredCount: weeklyEvents.filter((trainingEvent) => trainingEvent.result === "good").length,
    promotedCount: weeklyEvents.filter((trainingEvent) => promoted.has(trainingEvent)).length,
    weakPhraseIds: [...difficulty.entries()]
      .filter(([, score]) => score > 0)
      .sort(([leftId, leftScore], [rightId, rightScore]) =>
        rightScore - leftScore || leftId.localeCompare(rightId))
      .slice(0, 3)
      .map(([phraseId]) => phraseId),
  };
}
