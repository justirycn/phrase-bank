import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrainingHome } from "../../app/components/TrainingHome";

const base = {
  dailySummary: { activeSeconds: 0, completedGroups: 0, fullGoalReached: false },
  streak: { current: 0, longest: 0 },
  weeklySummary: { activeSeconds: 0, spokenCount: 0, masteredCount: 0, promotedCount: 0 },
  learnedToday: 0, nextLearningCount: 0, dueCount: 0, practiceCount: 0,
  onStartLearning: vi.fn(), onStartStandard: vi.fn(), onStartQuick: vi.fn(), onRetryHeatmap: vi.fn(),
};

describe("TrainingHome heatmap", () => {
  it("renders it after the weekly summary and preserves all entries", () => {
    const { container } = render(<TrainingHome {...base} heatmapDays={[{ date: "2026-08-10", count: 0, level: 0, future: false }]} />);
    const weekly = container.querySelector(".weekly-summary");
    const heatmap = container.querySelector(".learning-heatmap");
    expect(weekly?.compareDocumentPosition(heatmap as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    fireEvent.click(screen.getByRole("button", { name: /今日复习/ }));
    fireEvent.click(screen.getByRole("button", { name: /三分钟速练/ }));
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(base.onStartStandard).toHaveBeenCalled();
    expect(base.onStartQuick).toHaveBeenCalled();
  });

  it("keeps entries usable when the heatmap fails", () => {
    render(<TrainingHome {...base} heatmapDays={[]} heatmapError="failed" />);
    fireEvent.click(screen.getByRole("button", { name: /学习新句/ }));
    expect(base.onStartLearning).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("学习足迹暂时无法加载");
  });
});
