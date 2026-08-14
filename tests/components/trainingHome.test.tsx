import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrainingHome } from "../../app/components/TrainingHome";

const base = {
  dailyProgress: { correct: 3, mastered: 2, reviewed: 4 },
  streak: { current: 0, longest: 0 },
  weeklySummary: { weekStart: "2026-08-03", activeSeconds: 0, completedGroups: 0, spokenCount: 0, masteredCount: 0, promotedCount: 0, retentionRate: undefined, forgettableCount: 0, weakPhraseIds: [] },
  learnedToday: 2, nextLearningCount: 0, dueCount: 0,
  onContinue: vi.fn(), onStartLearning: vi.fn(), onRetryHeatmap: vi.fn(),
};

describe("TrainingHome heatmap", () => {
  it("hides the footprint until heatmap props are supplied", () => {
    render(<TrainingHome {...base} heatmapDays={undefined} heatmapError={undefined} />);
    expect(screen.queryByRole("region", { name: "最近 12 周学习足迹" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "学习足迹" })).not.toBeInTheDocument();
  });

  it("renders it after the weekly summary and preserves the two independent entries", () => {
    const { container } = render(<TrainingHome {...base} dueCount={1} nextLearningCount={1} heatmapDays={[{ date: "2026-08-10", count: 0, level: 0, future: false }]} />);
    const weekly = container.querySelector(".weekly-summary");
    const heatmap = container.querySelector(".learning-heatmap");
    expect(weekly?.compareDocumentPosition(heatmap as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续今日任务/ }));
    fireEvent.click(screen.getByRole("button", { name: /自主学习/ }));
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /到期复习/ })).not.toBeInTheDocument();
    expect(screen.getByText("先完成今天到期的复习；想多学时，再开启自主学习。")).toBeVisible();
    expect(screen.getByText("今日答对")).toBeVisible();
    expect(screen.getByText("三日掌握")).toBeVisible();
    expect(screen.getByText("2 句")).toBeVisible();
    expect(screen.getByText("3 / 10 句")).toBeVisible();
    expect(screen.getByText("新学 2 句 · 复习 4 句")).toBeVisible();
    expect(screen.queryByText(/30 分钟|三分钟速练/)).not.toBeInTheDocument();
    expect(base.onContinue).toHaveBeenCalled();
    expect(base.onStartLearning).toHaveBeenCalled();
  });

  it.each([
    [7, "还差 3 句"],
    [10, "已完成今日目标"],
    [14, "超额完成 4 句"],
  ])("shows daily correct goal progress for %i correct phrases", (correct, status) => {
    render(<TrainingHome {...base} dailyProgress={{ correct, mastered: 1, reviewed: 2 }} dailyMasteryGoal={10} />);

    const progress = screen.getByRole("progressbar", { name: "今日答对进度" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "10");
    expect(progress).toHaveAttribute("aria-valuenow", String(Math.min(10, correct)));
    expect(progress).toHaveAttribute("aria-valuetext", correct > 10 ? `${correct} / 10 句，超额 ${correct - 10} 句` : `${correct} / 10 句`);
    expect(screen.getByText(`${correct} / 10 句`)).toBeVisible();
    expect(screen.getByText("三日掌握").parentElement).toHaveTextContent("1 句");
    expect(screen.queryByText("今日巩固")).not.toBeInTheDocument();
    expect(screen.getByText(status)).toBeVisible();
    expect(progress.querySelector("i")).toHaveStyle({ width: `${Math.min(100, correct * 10)}%` });
  });

  it("uses the daily entry only for scheduled review and prioritizes active review copy", () => {
    const { container, rerender } = render(<TrainingHome {...base} dueCount={0} />);

    const daily = screen.getByRole("button", { name: /^继续今日任务/ });
    expect(daily).toBeDisabled();
    expect(daily).toHaveTextContent("今日复习已完成");
    expect(container.querySelector('.continue-start [data-icon="due-review"]')).toBeInTheDocument();

    rerender(<TrainingHome {...base} dueCount={4} />);
    expect(screen.getByRole("button", { name: /^继续今日任务/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^继续今日任务/ })).toHaveTextContent("今天到期 4 句");

    rerender(<TrainingHome {...base} dueCount={0} activeReview reviewRemaining={2} />);
    expect(screen.getByRole("button", { name: /^继续今日任务/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^继续今日任务/ })).toHaveTextContent("继续未完成 · 剩余 2 句");

    rerender(<TrainingHome {...base} dueCount={4} activeReview reviewRemaining={2} />);
    expect(screen.getByRole("button", { name: /^继续今日任务/ })).not.toHaveTextContent("今天到期 4 句");
  });

  it("uses the autonomous entry only for new learning and prioritizes its active group", () => {
    const { container, rerender } = render(<TrainingHome {...base} nextLearningCount={5} themeName="工作" />);

    const autonomous = screen.getByRole("button", { name: /^自主学习/ });
    expect(autonomous).toBeEnabled();
    expect(autonomous).toHaveTextContent("开始学习 5 句 · 工作");
    expect(container.querySelector(".learning-start [data-icon=\"due-review\"]")).not.toBeInTheDocument();
    expect(container.querySelector(".learning-start svg")).toBeInTheDocument();

    rerender(<TrainingHome {...base} nextLearningCount={5} activeLearning activeRemaining={3} themeName="工作" />);
    expect(screen.getByRole("button", { name: /^自主学习/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^自主学习/ })).toHaveTextContent("继续上次 · 剩余 3 句");
    expect(screen.getByRole("button", { name: /^自主学习/ })).not.toHaveTextContent("开始学习 5 句");

    rerender(<TrainingHome {...base} nextLearningCount={0} activeLearning={false} />);
    expect(screen.getByRole("button", { name: /^自主学习/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^自主学习/ })).toHaveTextContent("暂无新句，可去句库添加");
  });

  it("shows durable weekly outcomes and renders an absent retention rate as dashes", () => {
    render(<TrainingHome {...base} streak={{ current: 99, lightDaysUsedThisWeek: 0 }} weeklySummary={{ ...base.weeklySummary, activeSeconds: 9999, spokenCount: 98, forgettableCount: 3 }} />);

    expect(screen.queryByText("开口次数")).not.toBeInTheDocument();
    expect(screen.queryByText("有效分钟")).not.toBeInTheDocument();
    expect(screen.queryByText("连续天数")).not.toBeInTheDocument();
    expect(screen.getByText("本周掌握")).toBeVisible();
    expect(screen.getByText("本周复习保持率")).toBeVisible();
    expect(screen.getByText("容易忘记")).toBeVisible();
    expect(screen.getByText("--")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("从模糊到掌握")).toBeVisible();
  });

  it("keeps entries usable when the heatmap fails", () => {
    render(<TrainingHome {...base} nextLearningCount={1} heatmapDays={[]} heatmapError="failed" />);
    fireEvent.click(screen.getByRole("button", { name: /自主学习/ }));
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("学习足迹暂时无法加载");
  });
});
