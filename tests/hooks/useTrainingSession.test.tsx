import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrainingSession } from "../../app/hooks/useTrainingSession";
import type { PhraseRepository } from "../../app/storage/repository";
import type { Phrase, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

const phrase = (id: string): Phrase => ({
  id, english: `English ${id}`, chinese: `中文 ${id}`, categoryId: "daily",
  personalExample: "", sourceNote: "", reviewStep: 1, masteryLevel: 1,
  nextReviewAt: "2026-08-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", lastReviewedAt: "2026-01-02T00:00:00.000Z",
});

function memoryRepository(items = Array.from({ length: 12 }, (_, index) => phrase(`p-${index}`))) {
  const events: TrainingEvent[] = [];
  const reviewedEventIds = new Set<string>();
  let session: TrainingSessionRecord | undefined;
  const preferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };
  const repository = {
    listPhrases: vi.fn(async () => items),
    getPhrase: vi.fn(async (id: string) => items.find((item) => item.id === id)),
    saveTrainingEvent: vi.fn(async (event: TrainingEvent) => {
      const existing = events.findIndex((item) => item.id === event.id);
      if (existing >= 0) events[existing] = event;
      else events.push(event);
    }),
    submitTrainingReview: vi.fn(async (event: TrainingEvent) => {
      if (reviewedEventIds.has(event.id)) return;
      const existing = events.findIndex((item) => item.id === event.id);
      if (existing >= 0) events[existing] = event;
      else events.push(event);
      reviewedEventIds.add(event.id);
    }),
    listTrainingEvents: vi.fn(async () => [...events]),
    saveTrainingSession: vi.fn(async (next: TrainingSessionRecord) => { session = structuredClone(next); }),
    getActiveTrainingSession: vi.fn(async () => session && !session.completedAt ? structuredClone(session) : undefined),
    completeTrainingSession: vi.fn(async (id: string, completedAt: Date) => {
      if (session?.id === id) session = { ...session, completedAt: completedAt.toISOString() };
    }),
    submitReview: vi.fn(async () => undefined),
    getSpeechPreferences: vi.fn(async () => preferences),
  } as unknown as PhraseRepository;
  return { repository, events, getSession: () => session };
}

function services() {
  return {
    speech: { speak: vi.fn(async () => undefined), cancel: vi.fn(), listVoices: vi.fn(() => []) },
    recorder: {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => ({ blob: new Blob(["voice"]), url: "blob:voice" })),
      dispose: vi.fn(),
    },
  };
}

describe("useTrainingSession", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-09T08:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it.each([["standard", 10], ["quick", 3]] as const)("starts a %s group with %i candidates", async (mode, total) => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode, ...api, seed: "day" }));
    await waitFor(() => expect(result.current.total).toBe(total));
    expect(result.current.phase).toBe("prompt");
  });

  it("records unknown once, reveals it and appends the phrase once", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    const first = result.current.current!.phrase.id;
    await act(() => result.current.revealAsUnknown());
    expect(result.current.phase).toBe("answer");
    expect(result.current.total).toBe(4);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]).toMatchObject({ phraseId: first, result: "again" });
    await act(() => result.current.revealAsUnknown());
    expect(store.events).toHaveLength(1);
    expect(store.getSession()?.phraseIds.filter((id) => id === first)).toHaveLength(2);
  });

  it("uses pronunciation without revealing and caps a good grade", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await act(() => result.current.usePronunciationHint());
    expect(result.current.usedHint).toBe(true);
    expect(result.current.phase).toBe("prompt");
    expect(api.speech.speak).toHaveBeenCalledWith(result.current.current!.phrase.english, "en-US");
    await expect(act(() => result.current.grade("good"))).resolves.toEqual({ accepted: false });
    expect(store.events).toHaveLength(0);
  });

  it("keeps pronunciation failures non-blocking", async () => {
    const store = memoryRepository();
    const api = services();
    api.speech.speak.mockRejectedValue(new Error("not supported"));
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await expect(act(() => result.current.usePronunciationHint())).resolves.toBeUndefined();
    expect(result.current.phase).toBe("prompt");
    await expect(act(() => result.current.revealAsUnknown())).resolves.toBeUndefined();
    expect(result.current.phase).toBe("answer");
  });

  it("persists one hard event and advances", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await act(async () => {
      await Promise.all([result.current.grade("hard"), result.current.grade("hard")]);
    });
    expect(store.events).toHaveLength(1);
    expect(store.events[0].result).toBe("hard");
    expect(result.current.index).toBe(1);
    expect(store.getSession()?.currentIndex).toBe(1);
  });

  it("counts only visible recent interaction and checkpoints each 30 active seconds", async () => {
    const store = memoryRepository();
    const api = services();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    act(() => window.dispatchEvent(new Event("pointerdown")));
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(store.getSession()!.activeSeconds).toBeGreaterThanOrEqual(30);
    const savesAtThirty = (store.repository.saveTrainingSession as ReturnType<typeof vi.fn>).mock.calls.length;
    visibility.mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    const afterHidden = store.getSession()!.activeSeconds;
    expect(afterHidden).toBeLessThan(35);
    visibility.mockReturnValue("visible");
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(store.getSession()!.activeSeconds - afterHidden).toBeLessThanOrEqual(10);
    expect((store.repository.saveTrainingSession as ReturnType<typeof vi.fn>).mock.calls.length).toBe(savesAtThirty);
  });

  it("reveals after recording, auto-speaks, and never persists its blob URL", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await act(() => result.current.startRecording());
    expect(result.current.phase).toBe("recording");
    await act(() => result.current.stopRecording());
    expect(result.current.phase).toBe("answer");
    expect(result.current.recordingUrl).toBe("blob:voice");
    expect(api.speech.speak).toHaveBeenCalled();
    expect(JSON.stringify(store.getSession())).not.toContain("blob:voice");
    await act(() => result.current.finish());
    expect(api.recorder.dispose).toHaveBeenCalled();
    expect(api.speech.cancel).toHaveBeenCalled();
  });

  it("restores the saved queue and index after remount and disposes temporary media", async () => {
    const store = memoryRepository();
    const api = services();
    const first = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(first.result.current.current).toBeDefined());
    await act(() => first.result.current.grade("hard"));
    const saved = structuredClone(store.getSession()!);
    first.unmount();
    expect(api.recorder.dispose).toHaveBeenCalled();
    const second = renderHook(() => useTrainingSession({ repository: store.repository, mode: "standard", ...api, seed: "other" }));
    await waitFor(() => expect(second.result.current.index).toBe(1));
    expect(second.result.current.total).toBe(saved.phraseIds.length);
    expect(second.result.current.current?.phrase.id).toBe(saved.phraseIds[1]);
  });

  it("restores an unknown answer without recording or reviewing it twice", async () => {
    const store = memoryRepository();
    const api = services();
    const first = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(first.result.current.current).toBeDefined());
    await act(() => first.result.current.revealAsUnknown());
    expect(store.events).toHaveLength(1);
    expect(store.repository.submitTrainingReview).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(second.result.current.phase).toBe("answer"));
    await act(() => second.result.current.revealAsUnknown());
    expect(store.events).toHaveLength(1);
    expect(store.repository.submitTrainingReview).toHaveBeenCalledTimes(1);
    await act(() => second.result.current.grade("hard"));
    expect(second.result.current.index).toBe(1);
    expect(store.events).toHaveLength(1);
    expect(store.repository.submitTrainingReview).toHaveBeenCalledTimes(1);
  });

  it("preserves every candidate source across remounts", async () => {
    const store = memoryRepository();
    const api = services();
    const first = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "day" }));
    await waitFor(() => expect(first.result.current.current).toBeDefined());
    await act(() => first.result.current.revealAsUnknown());
    const savedSources = [...store.getSession()!.sources!];
    expect(savedSources.at(-1)).toBe("requeue");
    first.unmount();
    const second = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "different" }));
    await waitFor(() => expect(second.result.current.total).toBe(savedSources.length));
    expect(store.getSession()!.sources).toEqual(savedSources);
  });

  it.each([
    { label: "before the cursor", phraseIds: ["missing", "a", "c"], sources: ["weak", "due", "mature"] as const, cursor: 2 },
    { label: "at the cursor", phraseIds: ["a", "missing", "c"], sources: ["due", "new", "mature"] as const, cursor: 1 },
  ])("normalizes the cursor when a saved phrase $label was deleted", async ({ phraseIds, sources, cursor }) => {
    const items = [phrase("a"), phrase("b"), phrase("c"), phrase("d")];
    const store = memoryRepository(items);
    const api = services();
    await store.repository.saveTrainingSession({
      id: "saved", mode: "standard", startedAt: "2026-08-09T07:00:00.000Z",
      updatedAt: "2026-08-09T07:00:00.000Z", phraseIds, sources: [...sources],
      currentIndex: cursor, activeSeconds: 4,
    });
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current?.phrase.id).toBe("c"));
    expect(result.current.index).toBe(1);
    await waitFor(() => expect(store.getSession()).toMatchObject({
      phraseIds: ["a", "c"], sources: ["due", "mature"], currentIndex: 1,
    }));
  });

  it("serializes a pending checkpoint before the final save and completion", async () => {
    const store = memoryRepository();
    const api = services();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const originalSave = store.repository.saveTrainingSession as ReturnType<typeof vi.fn>;
    originalSave.mockImplementationOnce(async (session: TrainingSessionRecord) => {
      await deferred;
      const target = store.getSession();
      if (target) Object.assign(target, structuredClone(session));
    });
    act(() => window.dispatchEvent(new Event("pointerdown")));
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    const finishing = result.current.finish();
    await Promise.resolve();
    expect(store.repository.completeTrainingSession).not.toHaveBeenCalled();
    release();
    await act(() => finishing);
    expect(store.repository.completeTrainingSession).toHaveBeenCalledTimes(1);
    expect(store.getSession()?.completedAt).toBeDefined();
    visibility.mockRestore();
  });

  it("retries a failed review with the same id and active-time snapshot", async () => {
    const store = memoryRepository();
    const api = services();
    const submit = store.repository.submitTrainingReview as ReturnType<typeof vi.fn>;
    submit.mockRejectedValueOnce(new Error("temporary failure"));
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await expect(act(() => result.current.grade("hard"))).rejects.toThrow("temporary failure");
    const firstAttempt = structuredClone(submit.mock.calls[0][0]);
    expect(store.events).toHaveLength(0);
    await act(() => result.current.grade("hard"));
    expect(store.events).toEqual([firstAttempt]);
    expect(submit.mock.calls[1][0]).toEqual(firstAttempt);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(result.current.index).toBe(1);
  });

  it("keeps the answered item visible until its next cursor is durably saved", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await act(() => result.current.startRecording());
    await act(() => result.current.stopRecording());
    const currentId = result.current.current!.phrase.id;
    const save = store.repository.saveTrainingSession as ReturnType<typeof vi.fn>;
    save.mockRejectedValueOnce(new Error("session write failed"));
    await expect(act(() => result.current.grade("hard"))).rejects.toThrow("session write failed");
    expect(result.current).toMatchObject({ phase: "answer", index: 0 });
    expect(result.current.current?.phrase.id).toBe(currentId);
    expect(store.events).toHaveLength(1);
    await act(() => result.current.grade("hard"));
    expect(result.current.index).toBe(1);
    expect(store.events).toHaveLength(1);
    expect(store.repository.submitTrainingReview).toHaveBeenCalledTimes(1);
  });

  it("keeps completion final when finish races an in-flight grade", async () => {
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const atomicSubmit = store.repository.submitTrainingReview as ReturnType<typeof vi.fn>;
    atomicSubmit.mockImplementationOnce(async (event: TrainingEvent) => {
      await deferred;
      store.events.push(event);
    });
    let gradeOutcome: { accepted: boolean } | undefined;
    const grading = result.current.grade("hard").then((outcome) => { gradeOutcome = outcome; });
    const finishing = result.current.finish();
    release();
    await act(async () => { await Promise.all([grading, finishing]); });
    expect(gradeOutcome).toEqual({ accepted: false });
    expect(result.current.phase).toBe("complete");
    expect(result.current.index).toBe(0);
    expect(store.getSession()?.completedAt).toBeDefined();
    expect(await store.repository.getActiveTrainingSession()).toBeUndefined();
  });
});
