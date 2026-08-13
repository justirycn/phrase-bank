import { buildLearningHeatmap } from "../domain/learningHeatmap";
import type { PhraseRepository } from "../storage/repository";

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiCalendarDate(date: Date) {
  const parts = shanghaiDateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function shanghaiStartUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
}

export function shanghaiHeatmapRange(now = new Date()): { from: Date; to: Date } {
  const { year, month, day } = shanghaiCalendarDate(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - mondayOffset - 77);
  const from = shanghaiStartUtc(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, fromDate.getUTCDate());
  const tomorrow = shanghaiStartUtc(year, month, day + 1);
  return { from, to: new Date(tomorrow.getTime() - 1) };
}

function shanghaiEventRange(now: Date): { from: Date; to: Date } {
  const { year, month, day } = shanghaiCalendarDate(now);
  const fromDate = new Date(Date.UTC(year, month - 1, day));
  fromDate.setUTCDate(fromDate.getUTCDate() - 83);
  const from = shanghaiStartUtc(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, fromDate.getUTCDate());
  const tomorrow = shanghaiStartUtc(year, month, day + 1);
  return { from, to: new Date(tomorrow.getTime() - 1) };
}

export async function loadHomeData(repository: PhraseRepository, now = new Date()) {
  const heatmapRange = shanghaiHeatmapRange(now);
  const eventRange = shanghaiEventRange(now);
  const eventsResult = repository.listTrainingEvents(eventRange.from, eventRange.to).then(
    (events) => ({ ok: true as const, events }),
    () => ({ ok: false as const }),
  );
  const [
    phrases,
    categories,
    duePhrases,
    trainingSessions,
    learningStates,
    activeTrainingSession,
    activeLearningSession,
    appPreferences,
  ] = await Promise.all([
    repository.listPhrases(),
    repository.listCategories(),
    repository.listDuePhrases(now),
    repository.listTrainingSessions(heatmapRange.from, heatmapRange.to),
    repository.listPhraseLearningStates(),
    repository.getActiveTrainingSession(),
    repository.getActiveLearningSession(),
    repository.getAppPreferences(),
  ]);
  const eventRead = await eventsResult;
  const events = eventRead.ok ? eventRead.events : [];
  return {
    phrases,
    categories,
    duePhrases,
    trainingSessions,
    learningStates,
    activeTrainingSession,
    activeLearningSession,
    appPreferences,
    events,
    heatmap: eventRead.ok ? buildLearningHeatmap(events, now) : [],
    heatmapError: eventRead.ok ? "" : "学习足迹暂时无法加载",
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHomeData>>;
