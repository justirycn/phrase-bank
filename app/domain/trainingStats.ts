import type {
  DailyTrainingSummary,
  PhraseLearningState,
  TrainingEvent,
  TrainingSessionRecord,
} from "./types";
import { masteryAchievedDate } from "./learningProgress";

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
  retentionRate: number | undefined;
  forgettableCount: number;
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

export function summarizeDailySentenceProgress(date: string, events: TrainingEvent[], states: PhraseLearningState[]) {
  if (!parseCalendarDate(date)) return { mastered: 0, consolidated: 0, reviewed: 0 };
  const dailyEvents = events.filter((event) => shanghaiDate(event.occurredAt) === date);
  const masteredIds = new Set(states.filter((state) => masteryAchievedDate(state) === date).map((state) => state.phraseId));
  const goodTodayIds = new Set(dailyEvents.filter((event) => event.result === "good").map((event) => event.phraseId));
  return {
    mastered: masteredIds.size,
    consolidated: [...goodTodayIds].filter((phraseId) => !masteredIds.has(phraseId)).length,
    reviewed: new Set(dailyEvents.filter((event) => event.source !== "new").map((event) => event.phraseId)).size,
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
    retentionRate: undefined,
    forgettableCount: 0,
    weakPhraseIds: [],
  };
}

function chronologicalEvents(events: TrainingEvent[]): TrainingEvent[] {
  return [...events].sort((left, right) => {
    const timeDifference = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });
}

function forgettablePhrases(events: TrainingEvent[], states: PhraseLearningState[], asOf: string): string[] {
  const asOfDate = parseCalendarDate(asOf);
  if (!asOfDate) return [];
  const windowStart = calendarDate(addCalendarDays(asOfDate, -83));
  const stableIds = new Set(states.filter((state) => masteryAchievedDate(state) !== undefined).map((state) => state.phraseId));
  const byPhrase = new Map<string, TrainingEvent[]>();
  for (const event of chronologicalEvents(events)) {
    const date = shanghaiDate(event.occurredAt);
    if (!date || date < windowStart || date > asOf || stableIds.has(event.phraseId)) continue;
    byPhrase.set(event.phraseId, [...(byPhrase.get(event.phraseId) ?? []), event]);
  }
  const candidates: Array<{ phraseId: string; latestFailureAt: number }> = [];
  for (const [phraseId, phraseEvents] of byPhrase) {
    let latestFailureAt = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < phraseEvents.length; index += 1) {
      const current = phraseEvents[index];
      if (current.result === "again" || (current.result === "hard" && phraseEvents[index - 1]?.result === "hard")) {
        latestFailureAt = Math.max(latestFailureAt, new Date(current.occurredAt).getTime());
      }
    }
    if (latestFailureAt > Number.NEGATIVE_INFINITY) candidates.push({ phraseId, latestFailureAt });
  }
  return candidates.sort((left, right) => right.latestFailureAt - left.latestFailureAt || left.phraseId.localeCompare(right.phraseId)).map(({ phraseId }) => phraseId);
}

export function summarizeWeek(
  events: TrainingEvent[],
  sessions: TrainingSessionRecord[],
  states: PhraseLearningState[],
  weekStart: string,
  asOf?: string,
): WeeklyTrainingSummary {
  const start = parseCalendarDate(weekStart);
  if (!start) return zeroWeek(weekStart);
  const end = calendarDate(addCalendarDays(start, 6));
  const effectiveEnd = asOf && parseCalendarDate(asOf) && asOf < end ? asOf : end;
  const weeklyEvents = events.filter((trainingEvent) => {
    const date = shanghaiDate(trainingEvent.occurredAt);
    return date !== undefined && date >= weekStart && date <= effectiveEnd;
  });
  const promoted = promotedEvents(events);
  const latestReviewByPhrase = new Map<string, TrainingEvent>();
  for (const trainingEvent of chronologicalEvents(weeklyEvents)) {
    if (trainingEvent.source !== "new") latestReviewByPhrase.set(trainingEvent.phraseId, trainingEvent);
  }
  const latestReviews = [...latestReviewByPhrase.values()];
  const retentionRate = latestReviews.length ? Math.round((latestReviews.filter((event) => event.result === "good").length / latestReviews.length) * 100) : undefined;
  const forgettableIds = forgettablePhrases(events, states, asOf && parseCalendarDate(asOf) ? asOf : end);

  return {
    weekStart,
    activeSeconds: weeklyEvents.reduce((total, trainingEvent) => total + trainingEvent.activeSeconds, 0),
    completedGroups: sessions.filter((trainingSession) => {
      if (trainingSession.completedAt === undefined) return false;
      const date = shanghaiDate(trainingSession.completedAt);
      return date !== undefined && date >= weekStart && date <= effectiveEnd;
    }).length,
    spokenCount: weeklyEvents.filter((trainingEvent) => trainingEvent.recorded).length,
    masteredCount: states.filter((state) => {
      const achieved = masteryAchievedDate(state);
      return achieved !== undefined && achieved >= weekStart && achieved <= effectiveEnd;
    }).length,
    promotedCount: weeklyEvents.filter((trainingEvent) => promoted.has(trainingEvent)).length,
    retentionRate,
    forgettableCount: forgettableIds.length,
    weakPhraseIds: forgettableIds.slice(0, 3),
  };
}
