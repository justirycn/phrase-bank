import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrainingHome } from "../../app/components/TrainingHome";

const base = {
  dailyProgress: { mastered: 3, reviewed: 4 },
  streak: { current: 0, longest: 0 },
  weeklySummary: { activeSeconds: 0, spokenCount: 0, masteredCount: 0, promotedCount: 0 },
  learnedToday: 2, nextLearningCount: 0, dueCount: 0,
  onContinue: vi.fn(), onStartLearning: vi.fn(), onStartStandard: vi.fn(), onRetryHeatmap: vi.fn(),
};

describe("TrainingHome heatmap", () => {
  it("hides the footprint until heatmap props are supplied", () => {
    render(<TrainingHome {...base} heatmapDays={undefined} heatmapError={undefined} />);
    expect(screen.queryByRole("region", { name: "最近 12 周学习足迹" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "学习足迹" })).not.toBeInTheDocument();
  });

  it("renders it after the weekly summary and preserves all entries", () => {
    const { container } = render(<TrainingHome {...base} dueCount={1} heatmapDays={[{ date: "2026-08-10", count: 0, level: 0, future: false }]} />);
    const weekly = container.querySelector(".weekly-summary");
    const heatmap = container.querySelector(".learning-heatmap");
    expect(weekly?.compareDocumentPosition(heatmap as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续今日任务/ }));
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    fireEvent.click(screen.getByRole("button", { name: /到期复习/ }));
    expect(screen.getByText("今日掌握")).toBeVisible();
    expect(screen.getByText("3 / 10 句")).toBeVisible();
    expect(screen.getByText("新学 2 句 · 复习 4 句")).toBeVisible();
    expect(screen.queryByText(/30 分钟|三分钟速练/)).not.toBeInTheDocument();
    expect(base.onContinue).toHaveBeenCalled();
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(base.onStartStandard).toHaveBeenCalled();
  });

  it.each([
    [7, "还差 3 句"],
    [10, "已完成今日目标"],
    [14, "超额完成 4 句"],
  ])("shows mastery goal progress for %i mastered phrases", (mastered, status) => {
    render(<TrainingHome {...base} dailyProgress={{ mastered, reviewed: 2 }} dailyMasteryGoal={10} />);

    const progress = screen.getByRole("progressbar", { name: "今日掌握进度" });
    expect(progress).toHaveAttribute("aria-valuemin", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "10");
    expect(progress).toHaveAttribute("aria-valuenow", String(mastered));
    expect(screen.getByText(`${mastered} / 10 句`)).toBeVisible();
    expect(screen.getByText(status)).toBeVisible();
    expect(progress.querySelector("i")).toHaveStyle({ width: `${Math.min(100, mastered * 10)}%` });
  });

  it("labels only scheduled phrases as due review and uses a distinct review icon", () => {
    const { container, rerender } = render(<TrainingHome {...base} dueCount={0} />);

    expect(screen.getByRole("button", { name: /^到期复习/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^到期复习/ })).toHaveTextContent("今天暂无到期内容");
    expect(container.querySelector('.standard-start [data-icon="due-review"]')).toBeInTheDocument();

    rerender(<TrainingHome {...base} dueCount={4} />);
    expect(screen.getByRole("button", { name: /^到期复习/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^到期复习/ })).toHaveTextContent("4 句到期");
    expect(screen.getByRole("button", { name: /继续今日任务/ })).toHaveTextContent("4 句到期");

    rerender(<TrainingHome {...base} dueCount={0} activeReview reviewRemaining={2} />);
    expect(screen.getByRole("button", { name: /^到期复习/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^到期复习/ })).toHaveTextContent("继续未完成 · 剩余 2 句");
  });

  it("does not show speaking count in the weekly summary", () => {
    render(<TrainingHome {...base} weeklySummary={{ ...base.weeklySummary, spokenCount: 99 }} />);

    expect(screen.queryByText("开口次数")).not.toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.getByText("有效分钟")).toBeVisible();
    expect(screen.getByText("连续天数")).toBeVisible();
    expect(screen.getByText("本周掌握")).toBeVisible();
    expect(screen.getByText("从模糊到掌握")).toBeVisible();
  });

  it("keeps entries usable when the heatmap fails", () => {
    render(<TrainingHome {...base} heatmapDays={[]} heatmapError="failed" />);
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("学习足迹暂时无法加载");
  });
});
