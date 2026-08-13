import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhraseRepository } from "../../app/storage/repository";

function homeRepository() {
  return {
    initialize: vi.fn(async () => undefined),
    listPhrases: vi.fn(async () => []), listCategories: vi.fn(async () => []), listDuePhrases: vi.fn(async () => []),
    listTrainingEvents: vi.fn(async () => []), listTrainingSessions: vi.fn(async () => []),
    listPhraseLearningStates: vi.fn(async () => []), getActiveLearningSession: vi.fn(async () => undefined),
    getActiveTrainingSession: vi.fn(async () => undefined),
    getAppPreferences: vi.fn(async () => ({ dailyMasteryGoal: 10 })),
  } as unknown as PhraseRepository;
}

afterEach(() => {
  vi.doUnmock("../../app/components/screens/LibraryScreen");
  vi.doUnmock("../../app/components/screens/AddPhraseScreen");
  vi.resetModules();
});

describe("non-home screen loading", () => {
  it("does not request the non-home screen module until navigation, then shows an accessible fallback", async () => {
    let resolveScreens!: (module: Record<string, unknown>) => void;
    const loadScreens = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { resolveScreens = resolve; }));
    vi.doMock("../../app/components/screens/LibraryScreen", loadScreens);
    const { PhraseBankApp } = await import("../../app/PhraseBankApp");
    const repository = homeRepository();

    await act(async () => { render(<PhraseBankApp repository={repository} />); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "句库" })).toBeVisible();
    expect(loadScreens).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "句库" })); await Promise.resolve(); });
    expect(loadScreens).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status", { name: "正在打开句库" })).toBeVisible();

    await act(async () => { resolveScreens({ default: () => <h1>延迟句库</h1> }); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "延迟句库" })).toBeVisible();
  }, 20_000);

  it("retries a failed screen loader and clears the error when the second load succeeds", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loadLibrary = vi.fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ default: () => <h1>重试后的句库</h1> });
    vi.doMock("../../app/components/screens/LibraryScreen", loadLibrary);
    const { PhraseBankApp } = await import("../../app/PhraseBankApp");

    await act(async () => { render(<PhraseBankApp repository={homeRepository()} />); await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "句库" })); await Promise.resolve(); });

    expect(await screen.findByRole("alert")).toHaveTextContent("界面暂时无法加载，请重试。");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新加载" })); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "重试后的句库" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loadLibrary).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  }, 20_000);

  it("keeps the newest screen when an older pending screen finishes after a quick switch", async () => {
    let resolveLibrary!: (module: Record<string, unknown>) => void;
    vi.doMock("../../app/components/screens/LibraryScreen", () => new Promise<Record<string, unknown>>((resolve) => { resolveLibrary = resolve; }));
    vi.doMock("../../app/components/screens/AddPhraseScreen", () => ({ default: () => <h1>当前添加页</h1> }));
    const { PhraseBankApp } = await import("../../app/PhraseBankApp");

    await act(async () => { render(<PhraseBankApp repository={homeRepository()} />); await Promise.resolve(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "句库" })); await Promise.resolve(); });
    expect(await screen.findByRole("status", { name: "正在打开句库" })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "添加" })); await Promise.resolve(); });
    expect(await screen.findByRole("heading", { name: "当前添加页" })).toBeVisible();

    await act(async () => { resolveLibrary({ default: () => <h1>过期句库</h1> }); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "当前添加页" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "过期句库" })).not.toBeInTheDocument();
  }, 20_000);
});
