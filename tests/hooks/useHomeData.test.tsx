import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingEvent } from "../../app/domain/types";
import * as homeDataService from "../../app/services/homeData";
import type { HomeData } from "../../app/services/homeData";
import type { PhraseRepository } from "../../app/storage/repository";
import { useHomeData } from "../../app/hooks/useHomeData";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(): PhraseRepository {
  return { listTrainingEvents: vi.fn() } as unknown as PhraseRepository;
}

function data(label: string, overrides: Partial<HomeData> = {}): HomeData {
  return {
    phrases: [{ id: label }], categories: [], duePhrases: [], trainingSessions: [],
    learningStates: [], activeTrainingSession: undefined, activeLearningSession: undefined,
    events: [], heatmap: [], heatmapError: "", ...overrides,
  } as HomeData;
}

function event(id: string, occurredAt = "2026-08-10T04:00:00.000Z"): TrainingEvent {
  return { id, sessionId: "session", phraseId: id, source: "due", result: "good",
    usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt };
}

describe("useHomeData", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is idle and has safe actions without a repository", async () => {
    const { result } = renderHook(() => useHomeData(undefined));
    expect(result.current).toMatchObject({ data: undefined, loading: false, error: "" });
    await act(async () => {
      await result.current.refresh(); await result.current.retry(); await result.current.retryHeatmap();
    });
  });

  it("loads initially and exposes successful data", async () => {
    const repo = repository();
    const pending = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useHomeData(repo));
    expect(result.current.loading).toBe(true);
    pending.resolve(data("loaded"));
    await waitFor(() => expect(result.current.data).toEqual(data("loaded")));
    expect(result.current).toMatchObject({ loading: false, error: "" });
  });

  it("reports an initial failure and retry can succeed", async () => {
    const repo = repository();
    vi.spyOn(homeDataService, "loadHomeData")
      .mockRejectedValueOnce(new Error("closed"))
      .mockResolvedValueOnce(data("retried"));
    const { result } = renderHook(() => useHomeData(repo));
    await waitFor(() => expect(result.current.error).toBe("本地数据暂时无法打开，请刷新后重试。"));
    await act(() => result.current.retry());
    expect(result.current).toMatchObject({ data: data("retried"), loading: false, error: "" });
  });

  it("preserves existing data when refresh fails", async () => {
    const repo = repository();
    const original = data("original");
    vi.spyOn(homeDataService, "loadHomeData").mockResolvedValueOnce(original).mockRejectedValueOnce(new Error("no"));
    const { result } = renderHook(() => useHomeData(repo));
    await waitFor(() => expect(result.current.data).toBe(original));
    await act(() => result.current.refresh());
    expect(result.current.data).toBe(original);
    expect(result.current.error).toBe("本地数据暂时无法刷新，你仍然可以继续使用。");
  });

  it("ignores late completion from a replaced repository", async () => {
    const a = repository(); const b = repository();
    const old = deferred<HomeData>(); const current = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const hook = renderHook(({ repo }) => useHomeData(repo), { initialProps: { repo: a } });
    hook.rerender({ repo: b });
    old.resolve(data("old"));
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.loading).toBe(true);
    current.resolve(data("new"));
    await waitFor(() => expect(hook.result.current.data).toEqual(data("new")));
    old.reject(new Error("too late"));
    expect(hook.result.current).toMatchObject({ loading: false, error: "" });
  });

  it("ignores a late rejection from a replaced repository", async () => {
    const a = repository(); const b = repository();
    const old = deferred<HomeData>(); const current = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const hook = renderHook(({ repo }) => useHomeData(repo), { initialProps: { repo: a } });
    hook.rerender({ repo: b });
    old.reject(new Error("stale failure"));
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current).toMatchObject({ data: undefined, loading: true, error: "" });
    current.resolve(data("new"));
    await waitFor(() => expect(hook.result.current.data).toEqual(data("new")));
    expect(hook.result.current).toMatchObject({ loading: false, error: "" });
  });

  it("makes concurrent refreshes latest-wins", async () => {
    const repo = repository();
    const first = deferred<HomeData>(); const second = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockResolvedValueOnce(data("base"))
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useHomeData(repo));
    await waitFor(() => expect(result.current.data).toEqual(data("base")));
    let one!: Promise<void>; let two!: Promise<void>;
    act(() => { one = result.current.refresh(); two = result.current.refresh(); });
    second.resolve(data("second")); await act(() => two);
    first.resolve(data("first")); await act(() => one);
    expect(result.current.data).toEqual(data("second"));
  });

  it("settles pending work after unmount without unhandled rejection", async () => {
    const pending = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(pending.promise);
    const unhandled = vi.fn(); window.addEventListener("unhandledrejection", unhandled);
    const hook = renderHook(() => useHomeData(repository()));
    hook.unmount(); pending.reject(new Error("late"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", unhandled);
  });

  it("safely ignores a resolved home load after unmount", async () => {
    const repo = repository();
    const pending = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(pending.promise);
    const unhandled = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.addEventListener("unhandledrejection", unhandled);
    try {
      const hook = renderHook(() => useHomeData(repo));
      hook.unmount();
      pending.resolve(data("late success"));
      await pending.promise;
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      expect(unhandled).not.toHaveBeenCalled();
      const unmountedUpdateWarnings = consoleError.mock.calls.filter((arguments_) =>
        arguments_.some((value) => typeof value === "string"
          && /(?:state update|update).*(?:unmounted|unmount)|unmounted.*(?:state update|update)/i.test(value)),
      );
      expect(unmountedUpdateWarnings).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", unhandled);
      consoleError.mockRestore();
    }
  });

  it("keeps an isolated initial heatmap error out of controller error", async () => {
    vi.spyOn(homeDataService, "loadHomeData").mockResolvedValueOnce(data("core", { heatmapError: "学习足迹暂时无法加载" }));
    const repo = repository();
    const { result } = renderHook(() => useHomeData(repo));
    await waitFor(() => expect(result.current.data?.heatmapError).toBe("学习足迹暂时无法加载"));
    expect(result.current.error).toBe("");
  });

  it("retries only the heatmap with the exact range and merges only heatmap fields", async () => {
    const repo = repository(); const now = () => new Date("2026-08-10T12:34:56.000Z");
    const original = data("core", { heatmapError: "学习足迹暂时无法加载" });
    vi.spyOn(homeDataService, "loadHomeData").mockResolvedValueOnce(original);
    const events = [event("fresh")];
    vi.mocked(repo.listTrainingEvents).mockResolvedValueOnce(events);
    const { result } = renderHook(() => useHomeData(repo, now));
    await waitFor(() => expect(result.current.data).toBe(original));
    await act(() => result.current.retryHeatmap());
    const range = homeDataService.shanghaiHeatmapRange(now());
    expect(repo.listTrainingEvents).toHaveBeenCalledWith(range.from, range.to);
    expect(result.current.data).toMatchObject({
      phrases: original.phrases, categories: original.categories, duePhrases: original.duePhrases,
      trainingSessions: original.trainingSessions, learningStates: original.learningStates,
      activeTrainingSession: original.activeTrainingSession, activeLearningSession: original.activeLearningSession,
      events, heatmapError: "",
    });
    expect(result.current.data?.heatmap).toHaveLength(84);
    expect(result.current.data?.phrases).toBe(original.phrases);
  });

  it("preserves heatmap and core data when heatmap retry fails", async () => {
    const repo = repository(); const original = data("core", { events: [event("old")], heatmap: [{ date: "old" }] as HomeData["heatmap"] });
    vi.spyOn(homeDataService, "loadHomeData").mockResolvedValueOnce(original);
    vi.mocked(repo.listTrainingEvents).mockRejectedValueOnce(new Error("no"));
    const { result } = renderHook(() => useHomeData(repo));
    await waitFor(() => expect(result.current.data).toBe(original));
    await act(() => result.current.retryHeatmap());
    expect(result.current.data).toMatchObject({ ...original, heatmapError: "学习足迹暂时无法加载" });
    expect(result.current.data?.events).toBe(original.events);
    expect(result.current.data?.heatmap).toBe(original.heatmap);
  });

  it("does not read events when there is no current data", async () => {
    const repo = repository(); const pending = deferred<HomeData>();
    vi.spyOn(homeDataService, "loadHomeData").mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useHomeData(repo));
    await act(() => result.current.retryHeatmap());
    expect(repo.listTrainingEvents).not.toHaveBeenCalled();
    pending.resolve(data("done"));
  });

  it("reinitializes only when the clock function identity changes", async () => {
    const repo = repository(); const clock = () => new Date("2026-08-10T00:00:00.000Z");
    const load = vi.spyOn(homeDataService, "loadHomeData").mockResolvedValue(data("ok"));
    const hook = renderHook(({ now }) => useHomeData(repo, now), { initialProps: { now: clock } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    hook.rerender({ now: clock });
    expect(load).toHaveBeenCalledTimes(1);
    const replacement = () => new Date("2026-08-11T00:00:00.000Z");
    hook.rerender({ now: replacement });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1][1]).toEqual(replacement());
  });
});
