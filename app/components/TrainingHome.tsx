import type { DailyTrainingResult, TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import { AppIcon } from "./AppIcon";
import { WeeklySummary } from "./WeeklySummary";

export function TrainingHome({ dailySummary, streak, weeklySummary, onStartStandard, onStartQuick }: {
  dailySummary: DailyTrainingResult; streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  onStartStandard: () => void; onStartQuick: () => void;
}) {
  const minutes = Math.floor(dailySummary.activeSeconds / 60);
  const percentage = Math.min(100, dailySummary.activeSeconds / 1800 * 100);
  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>今天，说出来</h1><p>每天累计半小时，不需要一次完成。</p></header>
    <section className="daily-progress" aria-label="今日训练进度"><div><span>今日累计</span><strong>{minutes} / 30 分钟</strong></div><div className="daily-progress-track"><i style={{ width: `${percentage}%` }} /></div><p><AppIcon name="clock" size={18} />满 20 分钟保持连续，30 分钟完成今日目标</p></section>
    <div className="training-entry"><button className="standard-start" onClick={onStartStandard}><span><AppIcon name="microphone" size={24} /><b>开始 10 分钟训练</b><small>约 10 个语言块</small></span><AppIcon name="forward" size={22} /></button><button className="quick-start" onClick={onStartQuick}><AppIcon name="play" size={21} />快速练一组 <small>3 个</small></button></div>
    <WeeklySummary streak={streak} summary={weeklySummary} />
  </div>;
}
