import type { TrainingStreak, WeeklyTrainingSummary } from "../domain/trainingStats";

export function WeeklySummary({ streak, summary }: { streak: TrainingStreak; summary: WeeklyTrainingSummary }) {
  return <section className="weekly-summary" aria-labelledby="weekly-title"><div><p className="eyebrow">THIS WEEK</p><h2 id="weekly-title">这周的进步</h2></div><div className="weekly-grid"><p><strong>{streak.current}</strong><span>连续天数</span></p><p><strong>{summary.spokenCount}</strong><span>开口次数</span></p><p><strong>{summary.masteredCount}</strong><span>本周掌握</span></p><p><strong>{summary.promotedCount}</strong><span>从模糊到掌握</span></p></div></section>;
}
