import type { TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import type { LearningHeatmapDay } from "../domain/learningHeatmap";
import { AppIcon } from "./AppIcon";
import { LearningHeatmap } from "./LearningHeatmap";
import { WeeklySummary, type WeeklyFocusPhrase } from "./WeeklySummary";

export function TrainingHome({ dailyProgress, dailyMasteryGoal = 10, streak, weeklySummary, focusPhrases, learnedToday, nextLearningCount, themeName, activeLearning, activeRemaining, activeReview, reviewRemaining, dueCount, heatmapDays, heatmapError, onRetryHeatmap, onContinue, onStartLearning, onStartStandard }: {
  streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  dailyProgress: { mastered: number; reviewed: number };
  dailyMasteryGoal?: number;
  focusPhrases?: WeeklyFocusPhrase[];
  learnedToday: number; nextLearningCount: number; themeName?: string; activeLearning?: boolean; activeRemaining?: number; activeReview?: boolean; reviewRemaining?: number; dueCount: number;
  heatmapDays?: LearningHeatmapDay[]; heatmapError?: string; onRetryHeatmap?: () => void;
  onContinue: () => void;
  onStartLearning: () => void;
  onStartStandard: () => void;
}) {
  const masteryRemaining = dailyMasteryGoal - dailyProgress.mastered;
  const masteryStatus = masteryRemaining > 0
    ? `还差 ${masteryRemaining} 句`
    : masteryRemaining === 0
      ? "已完成今日目标"
      : `超额完成 ${Math.abs(masteryRemaining)} 句`;
  const masteryPercent = Math.min(100, (dailyProgress.mastered / dailyMasteryGoal) * 100);

  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>{dailyProgress.mastered > 0 ? "今天有进步" : "今天，说出来"}</h1><p>先完成到期复习，再认识几句真正用得上的表达。</p></header>
    <section className="daily-progress" aria-label="今日句子进度"><div><span>今日掌握</span><strong>{dailyProgress.mastered} / {dailyMasteryGoal} 句</strong></div><div className="daily-progress-track" role="progressbar" aria-label="今日掌握进度" aria-valuemin={0} aria-valuemax={dailyMasteryGoal} aria-valuenow={dailyProgress.mastered}><i style={{ width: `${masteryPercent}%` }} /></div><p className="daily-goal-status">{masteryStatus}</p><p>新学 {learnedToday} 句 · 复习 {dailyProgress.reviewed} 句</p></section>
    <div className="training-entry">
      <button className="continue-start" onClick={onContinue}><span><AppIcon name="play" size={24} /><b>继续今日任务</b><small>{activeLearning ? "继续未完成的新句学习" : activeReview ? `继续未完成的到期复习 · 剩余 ${reviewRemaining ?? 0} 句` : dueCount > 0 ? `${dueCount} 句到期` : nextLearningCount > 0 ? `下一组 ${nextLearningCount} 句新内容` : "今天的任务已完成"}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="learning-start" onClick={onStartLearning}><span><AppIcon name="library" size={24} /><b>学习新句</b><small>今天已学 {learnedToday} / 15 · {activeLearning ? `恢复本组：剩余 ${activeRemaining ?? nextLearningCount} / 共 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : nextLearningCount > 0 ? `下一组 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}` : learnedToday >= 15 ? "今日学习完成" : "暂无新句"}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="standard-start" onClick={onStartStandard}><span><AppIcon name="dueReview" data-icon="due-review" size={24} /><b>到期复习</b><small>{dueCount > 0 ? `${dueCount} 句到期` : "今天暂无到期内容"}</small></span><AppIcon name="forward" size={22} /></button>
    </div>
    <WeeklySummary streak={streak} summary={weeklySummary} focusPhrases={focusPhrases} />
    {heatmapDays !== undefined || heatmapError ? <LearningHeatmap days={heatmapDays ?? []} error={heatmapError} onRetry={onRetryHeatmap} /> : null}
  </div>;
}
