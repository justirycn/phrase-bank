import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LearningHeatmapDay } from "../../app/domain/learningHeatmap";
import { LearningHeatmap } from "../../app/components/LearningHeatmap";

const day = (date: string, count: number, level: LearningHeatmapDay["level"], future = false): LearningHeatmapDay => ({ date, count, level, future });
const days = Array.from({ length: 84 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10);
  return day(date, 0, 0);
});

describe("LearningHeatmap", () => {
  it("renders the compact 12-week footprint", () => {
    render(<LearningHeatmap days={days} />);
    expect(screen.getByRole("region", { name: "最近 12 周学习足迹" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "学习足迹" })).toBeInTheDocument();
    expect(screen.getByText("最近 12 周")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(84);
  });

  it("labels dates and preserves every level boundary", () => {
    const fixture = [
      day("2026-08-10", 0, 0), day("2026-08-11", 1, 1), day("2026-08-12", 2, 1),
      day("2026-08-13", 3, 2), day("2026-08-14", 5, 2), day("2026-08-15", 6, 3),
      day("2026-08-16", 9, 3), day("2026-08-17", 10, 4), day("2026-08-18", 0, 0, true),
    ];
    render(<LearningHeatmap days={fixture} />);
    expect(screen.getByLabelText("8月10日，未学习")).toHaveClass("level-0");
    for (const [date, count, level] of [["8月11日", 1, 1], ["8月12日", 2, 1], ["8月13日", 3, 2], ["8月14日", 5, 2], ["8月15日", 6, 3], ["8月16日", 9, 3], ["8月17日", 10, 4]] as const) {
      expect(screen.getByLabelText(`${date}，完成${count}句`)).toHaveClass(`level-${level}`);
    }
    const future = screen.getByLabelText("8月18日，未来日期");
    expect(future).toHaveClass("future", "level-0");
    expect(future.className).not.toMatch(/level-[1-4]/);
  });

  it("shows a fixed error and retries only when available", () => {
    const retry = vi.fn();
    const { rerender } = render(<LearningHeatmap days={days} error="technical details" onRetry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("学习足迹暂时无法加载");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<LearningHeatmap days={days} error="still broken" />);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("stays stable as days and error change", () => {
    const { rerender } = render(<LearningHeatmap days={days.slice(0, 2)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    rerender(<LearningHeatmap days={days.slice(0, 3)} error="failed" />);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    rerender(<LearningHeatmap days={days.slice(0, 1)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("uses a safe label for malformed or impossible calendar dates", () => {
    render(<LearningHeatmap days={[
      day("not-a-date", 0, 0),
      day("2026-02-30", 2, 1),
      day("2026-00-10", 0, 0, true),
    ]} />);
    expect(screen.getByLabelText("日期未知，未学习")).toBeInTheDocument();
    expect(screen.getByLabelText("日期未知，完成2句")).toBeInTheDocument();
    expect(screen.getByLabelText("日期未知，未来日期")).toBeInTheDocument();
  });
});
