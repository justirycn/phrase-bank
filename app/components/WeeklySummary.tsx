import type { TrainingStreak, WeeklyTrainingSummary } from "../domain/trainingStats";

export interface WeeklyFocusPhrase { id: string; english: string; chinese: string }

export function WeeklySummary({ streak, summary, focusPhrases = [] }: { streak: TrainingStreak; summary: WeeklyTrainingSummary; focusPhrases?: WeeklyFocusPhrase[] }) {
  return <section className="weekly-summary" aria-labelledby="weekly-title">
    <div><p className="eyebrow">THIS WEEK</p><h2 id="weekly-title">这周的进步</h2></div>
    <div className="weekly-grid"><p><strong>{Math.floor(summary.activeSeconds / 60)}</strong><span>有效分钟</span></p><p><strong>{streak.current}</strong><span>连续天数</span></p><p><strong>{summary.spokenCount}</strong><span>开口次数</span></p><p><strong>{summary.masteredCount}</strong><span>本周掌握</span></p></div>
    <div className="weekly-focus"><h3>下周重点巩固</h3>{focusPhrases.length ? <ul>{focusPhrases.map((phrase) => <li key={phrase.id}><b>{phrase.english}</b><span>{phrase.chinese}</span></li>)}</ul> : <p>这周还没有明显薄弱项，继续保持开口练习。</p>}</div>
  </section>;
}
