import type { LearningHeatmapDay } from "../domain/learningHeatmap";

export function heatmapDayLabel(day: LearningHeatmapDay): string {
  const [, month = "", date = ""] = day.date.split("-");
  const calendarLabel = `${Number(month)}月${Number(date)}日`;
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
