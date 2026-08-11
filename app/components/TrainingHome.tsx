import type { DailyTrainingResult, TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import type { LearningHeatmapDay } from "../domain/learningHeatmap";
import { AppIcon } from "./AppIcon";
import { LearningHeatmap } from "./LearningHeatmap";
import { WeeklySummary, type WeeklyFocusPhrase } from "./WeeklySummary";

export function TrainingHome({ dailySummary, streak, weeklySummary, focusPhrases, learnedToday, nextLearningCount, themeName, activeLearning, activeRemaining, dueCount, practiceCount, heatmapDays = [], heatmapError, onRetryHeatmap, onStartLearning, onStartStandard, onStartQuick }: {
  dailySummary: DailyTrainingResult; streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  focusPhrases?: WeeklyFocusPhrase[];
  learnedToday: number; nextLearningCount: number; themeName?: string; activeLearning?: boolean; activeRemaining?: number; dueCount: number; practiceCount: number;
  heatmapDays?: LearningHeatmapDay[]; heatmapError?: string; onRetryHeatmap?: () => void;
  onStartLearning: () => void;
  onStartStandard: () => void; onStartQuick: () => void;
}) {
  const minutes = Math.floor(dailySummary.activeSeconds / 60);
  const percentage = Math.min(100, dailySummary.activeSeconds / 1800 * 100);
  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>{dailySummary.fullGoalReached ? "今天已经完成" : "今天，说出来"}</h1><p>{dailySummary.fullGoalReached ? "今天的目标完成了，想继续巩固也很好。" : "每天累计半小时，不需要一次完成。"}</p></header>
    <section className="daily-progress" aria-label="今日训练进度"><div><span>今日累计</span><strong>{minutes} / 30 分钟</strong></div><div className="daily-progress-track"><i style={{ width: `${percentage}%` }} /></div><p><AppIcon name="clock" size={18} />完成 {dailySummary.completedGroups} 组 · 满 20 分钟保持连续</p></section>
    <div className="training-entry">
      <button className="learning-start" onClick={onStartLearning}><span><AppIcon name="library" size={24} /><b>学习新句</b><small>今天已学 {learnedToday} / 15 · {activeLearning ? `恢复本组：剩余 ${activeRemaining ?? nextLearningCount} / 共 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : nextLearningCount > 0 ? `下一组 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : learnedToday >= 15 ? "今日学习完成" : "暂无新句"}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="standard-start" onClick={onStartStandard}><span><AppIcon name="microphone" size={24} /><b>今日复习</b><small>{dueCount} 句待复习</small></span><AppIcon name="forward" size={22} /></button>
      <button className="quick-start" onClick={onStartQuick}><AppIcon name="play" size={21} />三分钟速练 <small>{practiceCount} 句已学可练 · 每组最多 3 句</small></button>
    </div>
    <WeeklySummary streak={streak} summary={weeklySummary} focusPhrases={focusPhrases} />
    <LearningHeatmap days={heatmapDays} error={heatmapError} onRetry={onRetryHeatmap} />
  </div>;
}
