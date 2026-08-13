import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Review from "../../app/components/screens/ReviewScreen";
import type { Phrase } from "../../app/domain/types";

const phrase = (id: string): Phrase => ({
  id, english: `English ${id}`, chinese: `中文 ${id}`, categoryId: "daily",
  reviewStep: 0, masteryLevel: 0, nextReviewAt: "2026-08-10T08:00:00.000Z",
  createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z",
  origin: "personal", kind: "standalone",
});

describe("ReviewScreen operation identity", () => {
  it("reuses the operation id after rejection and rotates it only after advancing", async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(undefined);
    render(<Review phrases={[phrase("p1"), phrase("p2")]} onBack={vi.fn()} onGrade={onGrade} />);

    await user.click(screen.getByRole("button", { name: "显示英文答案" }));
    const good = screen.getByRole("button", { name: /掌握/ });
    fireEvent.click(good);
    await vi.waitFor(() => expect(onGrade).toHaveBeenCalledTimes(1));
    fireEvent.click(good);
    await vi.waitFor(() => expect(onGrade).toHaveBeenCalledTimes(2));

    expect(onGrade.mock.calls[1][2]).toBe(onGrade.mock.calls[0][2]);
    expect(await screen.findByText("中文 p2")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "显示英文答案" }));
    await user.click(screen.getByRole("button", { name: /掌握/ }));
    expect(onGrade.mock.calls[2][2]).not.toBe(onGrade.mock.calls[1][2]);
  });

  it("submits a displayed attempt only once while persistence is pending", async () => {
    let resolve!: () => void;
    const onGrade = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<Review phrases={[phrase("p1")]} onBack={vi.fn()} onGrade={onGrade} />);
    fireEvent.click(screen.getByRole("button", { name: "显示英文答案" }));
    const good = screen.getByRole("button", { name: /掌握/ });

    fireEvent.click(good);
    fireEvent.click(good);

    expect(onGrade).toHaveBeenCalledTimes(1);
    resolve();
    expect(await screen.findByText(/今天完成了/)).toBeVisible();
  });

  it("keeps the immutable B queue item when refresh removes graded A", async () => {
    const view = render(<Review phrases={[phrase("p1"), phrase("p2")]} onBack={vi.fn()} onGrade={async () => undefined} />);
    const onGrade = vi.fn(async () => {
      view.rerender(<Review phrases={[phrase("p2")]} onBack={vi.fn()} onGrade={onGrade} />);
    });
    view.rerender(<Review phrases={[phrase("p1"), phrase("p2")]} onBack={vi.fn()} onGrade={onGrade} />);
    fireEvent.click(screen.getByRole("button", { name: "显示英文答案" }));
    fireEvent.click(screen.getByRole("button", { name: /掌握/ }));

    expect(await screen.findByText("中文 p2")).toBeVisible();
    expect(screen.queryByText(/今天完成了/)).not.toBeInTheDocument();
  });

  it("does not advance a replacement repository queue when the old grade resolves", async () => {
    let resolveOld!: () => void;
    const oldGrade = vi.fn(() => new Promise<void>((resolve) => { resolveOld = resolve; }));
    const newGrade = vi.fn(async () => undefined);
    const view = render(<Review key="repo-a" phrases={[phrase("old-a"), phrase("old-b")]} onBack={vi.fn()} onGrade={oldGrade} />);
    fireEvent.click(screen.getByRole("button", { name: "显示英文答案" }));
    fireEvent.click(screen.getByRole("button", { name: /掌握/ }));
    view.rerender(<Review key="repo-b" phrases={[phrase("new-a"), phrase("new-b")]} onBack={vi.fn()} onGrade={newGrade} />);

    resolveOld();

    expect(await screen.findByText("中文 new-a")).toBeVisible();
    expect(screen.queryByText("中文 new-b")).not.toBeInTheDocument();
  });

  it("does not mount an empty replacement queue before its home data is ready", () => {
    const view = render(<Review key="repo-a" phrases={[phrase("old-a")]} onBack={vi.fn()} onGrade={vi.fn()} />);

    view.rerender(<div role="status">loading replacement</div>);

    expect(screen.getByRole("status")).toHaveTextContent("loading replacement");
    expect(screen.queryByText(/今天完成了/)).not.toBeInTheDocument();
    view.rerender(<Review key="repo-b" phrases={[phrase("new-a")]} onBack={vi.fn()} onGrade={vi.fn()} />);
    expect(screen.getByText("中文 new-a")).toBeVisible();
  });
});
