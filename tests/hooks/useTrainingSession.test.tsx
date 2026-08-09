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
  let session: TrainingSessionRecord | undefined;
  const preferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };
  const repository = {
    listPhrases: vi.fn(async () => items),
    getPhrase: vi.fn(async (id: string) => items.find((item) => item.id === id)),
    saveTrainingEvent: vi.fn(async (event: TrainingEvent) => { events.push(event); }),
    listTrainingEvents: vi.fn(async () => [...events]),
    saveTrainingSession: vi.fn(async (next: TrainingSessionRecord) => { session = structuredClone(next); }),
    getActiveTrainingSession: vi.fn(async () => session && structuredClone(session)),
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
});
