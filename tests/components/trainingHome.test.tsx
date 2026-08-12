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
    const { container } = render(<TrainingHome {...base} heatmapDays={[{ date: "2026-08-10", count: 0, level: 0, future: false }]} />);
    const weekly = container.querySelector(".weekly-summary");
    const heatmap = container.querySelector(".learning-heatmap");
    expect(weekly?.compareDocumentPosition(heatmap as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /继续今日任务/ }));
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    fireEvent.click(screen.getByRole("button", { name: /今日复习/ }));
    expect(screen.getByText("今日掌握")).toBeVisible();
    expect(screen.getByText("3 句")).toBeVisible();
    expect(screen.getByText("新学 2 句 · 复习 4 句")).toBeVisible();
    expect(screen.queryByText(/30 分钟|三分钟速练/)).not.toBeInTheDocument();
    expect(base.onContinue).toHaveBeenCalled();
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(base.onStartStandard).toHaveBeenCalled();
  });

  it("keeps entries usable when the heatmap fails", () => {
    render(<TrainingHome {...base} heatmapDays={[]} heatmapError="failed" />);
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("学习足迹暂时无法加载");
  });
});
