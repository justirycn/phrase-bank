import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhraseRepository } from "../../app/storage/repository";

function homeRepository() {
  return {
    initialize: vi.fn(async () => undefined),
    listPhrases: vi.fn(async () => []), listCategories: vi.fn(async () => []), listDuePhrases: vi.fn(async () => []),
    listTrainingEvents: vi.fn(async () => []), listTrainingSessions: vi.fn(async () => []),
    listPhraseLearningStates: vi.fn(async () => []), getActiveLearningSession: vi.fn(async () => undefined),
    getActiveTrainingSession: vi.fn(async () => undefined),
  } as unknown as PhraseRepository;
}

afterEach(() => {
  vi.doUnmock("../../app/components/screens/LibraryScreen");
  vi.resetModules();
});

describe("non-home screen loading", () => {
  it("does not request the non-home screen module until navigation, then shows an accessible fallback", async () => {
    const user = userEvent.setup();
    let resolveScreens!: (module: Record<string, unknown>) => void;
    const loadScreens = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { resolveScreens = resolve; }));
    vi.doMock("../../app/components/screens/LibraryScreen", loadScreens);
    const { PhraseBankApp } = await import("../../app/PhraseBankApp");
    const repository = homeRepository();

    render(<PhraseBankApp repository={repository} />);
    expect(await screen.findByRole("button", { name: "句库" })).toBeVisible();
    expect(loadScreens).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "句库" }));
    expect(loadScreens).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status", { name: "正在打开句库" })).toBeVisible();

    resolveScreens({ default: () => <h1>延迟句库</h1> });
    expect(await screen.findByRole("heading", { name: "延迟句库" })).toBeVisible();
  }, 10_000);

  it("retries a failed screen loader and clears the error when the second load succeeds", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadLibrary = vi.fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ default: () => <h1>重试后的句库</h1> });
    vi.doMock("../../app/components/screens/LibraryScreen", loadLibrary);
    const { PhraseBankApp } = await import("../../app/PhraseBankApp");

    render(<PhraseBankApp repository={homeRepository()} />);
    await user.click(await screen.findByRole("button", { name: "句库" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("界面暂时无法加载，请重试。");
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "重试后的句库" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loadLibrary).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  }, 10_000);
});
