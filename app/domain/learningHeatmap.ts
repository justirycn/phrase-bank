import type { TrainingEvent } from "./types";

export interface LearningHeatmapDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDate(date: Date): string | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = shanghaiDateFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function heatLevel(count: number): LearningHeatmapDay["level"] {
  if (count >= 10) return 4;
  if (count >= 6) return 3;
  if (count >= 3) return 2;
  if (count >= 1) return 1;
  return 0;
}

export function buildLearningHeatmap(
  events: TrainingEvent[],
  now: Date = new Date(),
): LearningHeatmapDay[] {
  const today = shanghaiDate(now);
  if (!today) return [];

  const todayDate = parseCalendarDate(today);
  const mondayOffset = (todayDate.getUTCDay() + 6) % 7;
  const gridStart = addDays(todayDate, -mondayOffset - 77);
  const gridEnd = calendarDate(addDays(gridStart, 83));
  const phraseIdsByDate = new Map<string, Set<string>>();

  for (const event of events) {
    if (typeof event.phraseId !== "string" || typeof event.occurredAt !== "string") continue;
    const phraseId = event.phraseId.trim();
    if (!phraseId) continue;
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > now.getTime()) continue;
    const date = shanghaiDate(occurredAt);
    if (date === undefined || date < calendarDate(gridStart) || date > gridEnd || date > today) continue;
    const phraseIds = phraseIdsByDate.get(date) ?? new Set<string>();
    phraseIds.add(phraseId);
    phraseIdsByDate.set(date, phraseIds);
  }

  return Array.from({ length: 84 }, (_, index) => {
    const date = calendarDate(addDays(gridStart, index));
    const count = phraseIdsByDate.get(date)?.size ?? 0;
    return { date, count, level: heatLevel(count), future: date > today };
  });
}
