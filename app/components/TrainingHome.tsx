import type { DailyTrainingResult, TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import type { LearningHeatmapDay } from "../domain/learningHeatmap";
import { AppIcon } from "./AppIcon";
import { LearningHeatmap } from "./LearningHeatmap";
import { WeeklySummary, type WeeklyFocusPhrase } from "./WeeklySummary";

export function TrainingHome({ dailySummary, dailyProgress, streak, weeklySummary, focusPhrases, learnedToday, nextLearningCount, themeName, activeLearning, activeRemaining, dueCount, heatmapDays, heatmapError, onRetryHeatmap, onContinue, onStartLearning, onStartStandard }: {
  dailySummary: DailyTrainingResult; streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  dailyProgress: { mastered: number; reviewed: number };
  focusPhrases?: WeeklyFocusPhrase[];
  learnedToday: number; nextLearningCount: number; themeName?: string; activeLearning?: boolean; activeRemaining?: number; dueCount: number;
  heatmapDays?: LearningHeatmapDay[]; heatmapError?: string; onRetryHeatmap?: () => void;
  onContinue: () => void;
  onStartLearning: () => void;
  onStartStandard: () => void;
}) {
  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>{dailyProgress.mastered > 0 ? "今天有进步" : "今天，说出来"}</h1><p>先完成到期复习，再认识几句真正用得上的表达。</p></header>
    <section className="daily-progress" aria-label="今日句子进度"><div><span>今日掌握</span><strong>{dailyProgress.mastered} 句</strong></div><p>新学 {learnedToday} 句 · 复习 {dailyProgress.reviewed} 句</p></section>
    <div className="training-entry">
      <button className="continue-start" onClick={onContinue}><span><AppIcon name="play" size={24} /><b>继续今日任务</b><small>{activeLearning ? "继续未完成的新句学习" : dueCount > 0 ? `${dueCount} 句待复习` : nextLearningCount > 0 ? `下一组 ${nextLearningCount} 句新内容` : "今天的任务已完成"}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="learning-start" onClick={onStartLearning}><span><AppIcon name="library" size={24} /><b>学习新句</b><small>今天已学 {learnedToday} / 15 · {activeLearning ? `恢复本组：剩余 ${activeRemaining ?? nextLearningCount} / 共 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : nextLearningCount > 0 ? `下一组 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : learnedToday >= 15 ? "今日学习完成" : "暂无新句"}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="standard-start" onClick={onStartStandard}><span><AppIcon name="microphone" size={24} /><b>今日复习</b><small>{dueCount} 句待复习</small></span><AppIcon name="forward" size={22} /></button>
    </div>
    <WeeklySummary streak={streak} summary={weeklySummary} focusPhrases={focusPhrases} />
    {heatmapDays !== undefined || heatmapError ? <LearningHeatmap days={heatmapDays ?? []} error={heatmapError} onRetry={onRetryHeatmap} /> : null}
  </div>;
}
