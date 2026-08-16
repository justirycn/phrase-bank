import type { TrainingStreak, WeeklyTrainingSummary as WeeklySummaryType } from "../domain/trainingStats";
import type { LearningHeatmapDay } from "../domain/learningHeatmap";
import type { DailyTask } from "../domain/dailyTask";
import { AppIcon } from "./AppIcon";
import { LearningHeatmap } from "./LearningHeatmap";
import { WeeklySummary, type WeeklyFocusPhrase } from "./WeeklySummary";

export function TrainingHome({ dailyProgress, dailyMasteryGoal = 10, dailyNewPhraseGoal, newCompletedToday, dailyTask, weeklySummary, focusPhrases, learnedToday, nextLearningCount, themeName, activeLearning, activeRemaining, activeDailyLearning, dailyLearningRemaining, activeReview, reviewRemaining, dueCount, heatmapDays, heatmapError, onRetryHeatmap, onContinue, onStartLearning }: {
  streak: TrainingStreak; weeklySummary: WeeklySummaryType;
  dailyProgress: { correct: number; mastered: number; reviewed: number };
  dailyMasteryGoal?: number;
  dailyNewPhraseGoal: number;
  newCompletedToday: number;
  dailyTask: DailyTask;
  focusPhrases?: WeeklyFocusPhrase[];
  learnedToday: number; nextLearningCount: number; themeName?: string; activeLearning?: boolean; activeRemaining?: number; activeDailyLearning?: boolean; dailyLearningRemaining?: number; activeReview?: boolean; reviewRemaining?: number; dueCount: number;
  heatmapDays?: LearningHeatmapDay[]; heatmapError?: string; onRetryHeatmap?: () => void;
  onContinue: () => void;
  onStartLearning: () => void;
}) {
  const correctRemaining = dailyMasteryGoal - dailyProgress.correct;
  const correctStatus = correctRemaining > 0
    ? `还差 ${correctRemaining} 句`
    : correctRemaining === 0
      ? "已完成今日目标"
      : `超额完成 ${Math.abs(correctRemaining)} 句`;
  const correctPercent = Math.min(100, (dailyProgress.correct / dailyMasteryGoal) * 100);
  const dailyTaskLabel = dailyTask.stage === "complete"
    ? "今日任务已完成"
    : dailyTask.stage === "review"
      ? activeReview
        ? `继续复习 · 剩余 ${reviewRemaining ?? 0} 句`
        : `到期复习 ${dueCount} 句 · 今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal}`
      : activeDailyLearning
        ? `继续今日新句 · 剩余 ${dailyLearningRemaining ?? 0} 句`
        : dailyTask.inventoryShortage > 0
          ? `今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal} · 还差 ${dailyTask.inventoryShortage} 句`
          : `到期复习已完成 · 今日新句 ${newCompletedToday} / ${dailyNewPhraseGoal}`;
  const autonomousLabel = !dailyTask.autonomousUnlocked
    ? "完成今日任务后开放"
    : activeLearning
      ? `继续上次 · 剩余 ${activeRemaining ?? nextLearningCount} 句`
      : nextLearningCount > 0
        ? `开始学习 ${nextLearningCount} 句${themeName ? ` · ${themeName}` : ""}`
        : "暂无新句，可去句库添加";

  return <div className="training-home">
    <header><p className="eyebrow">TODAY&apos;S SPEAKING</p><h1>{dailyProgress.correct > 0 ? "今天有进步" : "今天，说出来"}</h1><p>先完成今天到期的复习；想多学时，再开启自主学习。</p></header>
    <section className="daily-progress" aria-label="今日句子进度"><div><span>今日答对</span><strong>{dailyProgress.correct} / {dailyMasteryGoal} 句</strong></div><div className="daily-progress-track" role="progressbar" aria-label="今日答对进度" aria-valuemin={0} aria-valuemax={dailyMasteryGoal} aria-valuenow={Math.min(dailyMasteryGoal, dailyProgress.correct)} aria-valuetext={dailyProgress.correct > dailyMasteryGoal ? `${dailyProgress.correct} / ${dailyMasteryGoal} 句，超额 ${dailyProgress.correct - dailyMasteryGoal} 句` : `${dailyProgress.correct} / ${dailyMasteryGoal} 句`}><i style={{ width: `${correctPercent}%` }} /></div><p className="daily-goal-status">{correctStatus}</p><p className="daily-consolidated"><span>三日掌握</span><strong>{dailyProgress.mastered} 句</strong></p><p>新学 {learnedToday} 句 · 复习 {dailyProgress.reviewed} 句</p></section>
    <div className="training-entry">
      <button className="continue-start" onClick={onContinue} disabled={dailyTask.complete}><span><AppIcon name="dueReview" data-icon="due-review" size={24} /><b>继续今日任务</b><small className="daily-task-breakdown">{dailyTaskLabel}</small></span><AppIcon name="forward" size={22} /></button>
      <button className="learning-start" onClick={onStartLearning} disabled={!dailyTask.autonomousUnlocked || (!activeLearning && nextLearningCount === 0)}><span><AppIcon name="library" size={24} /><b>自主学习</b><small>{autonomousLabel}</small></span><AppIcon name="forward" size={22} /></button>
    </div>
    <WeeklySummary summary={weeklySummary} focusPhrases={focusPhrases} />
    {heatmapDays !== undefined || heatmapError ? <LearningHeatmap days={heatmapDays ?? []} error={heatmapError} onRetry={onRetryHeatmap} /> : null}
  </div>;
}
