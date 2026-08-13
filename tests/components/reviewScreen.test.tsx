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
});
