import type { DailyTrainingResult, TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import { AppIcon } from "./AppIcon";
import { WeeklySummary, type WeeklyFocusPhrase } from "./WeeklySummary";

export function TrainingHome({ dailySummary, streak, weeklySummary, focusPhrases, onStartStandard, onStartQuick }: {
  dailySummary: DailyTrainingResult; streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  focusPhrases?: WeeklyFocusPhrase[];
  onStartStandard: () => void; onStartQuick: () => void;
}) {
  const minutes = Math.floor(dailySummary.activeSeconds / 60);
  const percentage = Math.min(100, dailySummary.activeSeconds / 1800 * 100);
  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>{dailySummary.fullGoalReached ? "今天已经完成" : "今天，说出来"}</h1><p>{dailySummary.fullGoalReached ? "今天的目标完成了，想继续巩固也很好。" : "每天累计半小时，不需要一次完成。"}</p></header>
    <section className="daily-progress" aria-label="今日训练进度"><div><span>今日累计</span><strong>{minutes} / 30 分钟</strong></div><div className="daily-progress-track"><i style={{ width: `${percentage}%` }} /></div><p><AppIcon name="clock" size={18} />完成 {dailySummary.completedGroups} 组 · 满 20 分钟保持连续</p></section>
    <div className="training-entry"><button className="standard-start" onClick={onStartStandard}><span><AppIcon name="microphone" size={24} /><b>{dailySummary.fullGoalReached ? "再练一组" : "开始 10 分钟训练"}</b><small>约 10 个语言块</small></span><AppIcon name="forward" size={22} /></button><button className="quick-start" onClick={onStartQuick}><AppIcon name="play" size={21} />快速练一组 <small>3 个</small></button></div>
    <WeeklySummary streak={streak} summary={weeklySummary} focusPhrases={focusPhrases} />
  </div>;
}
