import type { LearningHeatmapDay } from "../domain/learningHeatmap";

export function heatmapDayLabel(day: LearningHeatmapDay): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date);
  const parsed = match ? new Date(`${day.date}T00:00:00Z`) : undefined;
  const valid = parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day.date;
  const calendarLabel = valid && match ? `${Number(match[2])}月${Number(match[3])}日` : "日期未知";
  if (day.future) return `${calendarLabel}，未来日期`;
  return day.count === 0 ? `${calendarLabel}，未学习` : `${calendarLabel}，完成${day.count}句`;
}

export function LearningHeatmap({ days, error, onRetry }: {
  days: LearningHeatmapDay[];
  error?: string;
  onRetry?: () => void;
}) {
  return <section className="learning-heatmap" aria-label="最近 12 周学习足迹">
    <div className="heatmap-heading"><h2>学习足迹</h2><p>最近 12 周</p></div>
    {error ? <div className="heatmap-error">
      <p role="status">学习足迹暂时无法加载</p>
      {onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}
    </div> : <>
      <ol className="heatmap-grid">
        {days.map((day, index) => {
          const level = day.future ? 0 : day.level;
          return <li key={`${day.date}-${index}`} className={`level-${level}${day.future ? " future" : ""}`} aria-label={heatmapDayLabel(day)} />;
        })}
      </ol>
      <div className="heatmap-legend" aria-hidden="true"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`level-${level}`} />)}<span>多</span></div>
    </>}
  </section>;
}
