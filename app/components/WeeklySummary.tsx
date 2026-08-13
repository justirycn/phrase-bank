import type { WeeklyTrainingSummary } from "../domain/trainingStats";

export interface WeeklyFocusPhrase { id: string; english: string; chinese: string; categoryName: string }

export function WeeklySummary({ summary, focusPhrases = [] }: { summary: WeeklyTrainingSummary; focusPhrases?: WeeklyFocusPhrase[] }) {
  return <section className="weekly-summary" aria-labelledby="weekly-title">
    <div><p className="eyebrow">THIS WEEK</p><h2 id="weekly-title">这周的进步</h2></div>
    <div className="weekly-grid"><p><strong>{summary.masteredCount}</strong><span>本周掌握</span></p><p><strong>{summary.retentionRate === undefined ? "--" : `${summary.retentionRate}%`}</strong><span>本周复习保持率</span></p><p><strong>{summary.forgettableCount}</strong><span>容易忘记</span></p><p><strong>{summary.promotedCount}</strong><span>从模糊到掌握</span></p></div>
    <div className="weekly-focus"><h3>下周重点巩固</h3>{focusPhrases.length ? <ul>{focusPhrases.map((phrase) => <li key={phrase.id}><small>{phrase.categoryName}</small><b>{phrase.english}</b><span>{phrase.chinese}</span></li>)}</ul> : <p>这周还没有明显薄弱项，继续保持开口练习。</p>}</div>
  </section>;
}
