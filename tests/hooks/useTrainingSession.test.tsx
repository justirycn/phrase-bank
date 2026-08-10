import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTrainingSession } from "../../app/hooks/useTrainingSession";
import type { PhraseRepository } from "../../app/storage/repository";
import type { Phrase, PhraseLearningState, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

const phrase = (id: string): Phrase => ({
  id, english: `English ${id}`, chinese: `中文 ${id}`, categoryId: "daily",
  personalExample: "", sourceNote: "", reviewStep: 1, masteryLevel: 1,
  nextReviewAt: "2026-08-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", lastReviewedAt: "2026-01-02T00:00:00.000Z",
});

const learnedState = (phraseId: string, stage: "learned" | "mastered" = "learned"): PhraseLearningState => ({
  phraseId,
  stage,
  consecutiveGood: stage === "mastered" ? 3 : 0,
  masteredDates: stage === "mastered" ? ["2026-08-08"] : [],
  updatedAt: "2026-08-08T00:00:00.000Z",
});

function memoryRepository(
  items = Array.from({ length: 12 }, (_, index) => phrase(`p-${index}`)),
  learningStates = items.map((item) => learnedState(item.id)),
  initialSessions: TrainingSessionRecord[] = [],
) {
  const events: TrainingEvent[] = [];
  const reviewedEventIds = new Set<string>();
  const sessions = structuredClone(initialSessions);
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
    listPhraseLearningStates: vi.fn(async () => structuredClone(learningStates)),
    saveTrainingSession: vi.fn(async (next: TrainingSessionRecord) => {
      const existing = sessions.findIndex(({ id }) => id === next.id);
      if (existing >= 0) sessions[existing] = structuredClone(next);
      else sessions.push(structuredClone(next));
    }),
    getActiveTrainingSession: vi.fn(async () => structuredClone([...sessions].reverse().find(({ completedAt }) => !completedAt))),
    completeTrainingSession: vi.fn(async (id: string, completedAt: Date) => {
      const session = sessions.find((item) => item.id === id);
      if (session) session.completedAt = completedAt.toISOString();
    }),
    exportSnapshot: vi.fn(async () => ({ trainingSessions: structuredClone(sessions) })),
    submitReview: vi.fn(async () => undefined),
    getSpeechPreferences: vi.fn(async () => preferences),
  } as unknown as PhraseRepository;
  return { repository, events, sessions, getSession: () => sessions.at(-1) };
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

  it("rotates a second quick group away from phrases already practiced today", async () => {
    const store = memoryRepository();
    const firstApi = services();
    const first = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...firstApi, seed: "same-day" }));
    await waitFor(() => expect(first.result.current.total).toBe(3));
    const firstIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      firstIds.push(first.result.current.current!.phrase.id);
      await act(() => first.result.current.grade("hard"));
    }
    await act(() => first.result.current.finish());
    first.unmount();

    const second = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...services(), seed: "same-day" }));
    await waitFor(() => expect(second.result.current.total).toBe(3));
    const secondIds = store.getSession()!.phraseIds;

    expect(secondIds).toHaveLength(3);
    expect(secondIds.every((id) => !firstIds.includes(id))).toBe(true);
  });

  it("starts and grades training when randomUUID is unavailable on an insecure origin", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) });
    const store = memoryRepository();
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "http-origin" }));

    await waitFor(() => expect(result.current.total).toBe(3));
    await act(async () => { await result.current.revealForSelfAssessment(); });
    await act(async () => { expect(await result.current.grade("good")).toEqual({ accepted: true }); });

    expect(store.getSession()?.id).toBeTruthy();
    expect(store.events).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("surfaces repository initialization failure without an unhandled rejection", async () => {
    const store = memoryRepository(); const api = services();
    (store.repository.listPhrases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db failed"));
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.initializationError).toBe("训练内容暂时无法加载，请检查本地数据后重试。"));
    expect(result.current.current).toBeUndefined();
    expect(result.current.total).toBe(0);
  });

  it("uses each phrase's latest Shanghai-day result and event id to exclude only latest-good phrases", async () => {
    const items = [phrase("latest-hard"), phrase("latest-good"), phrase("tie-good")];
    const store = memoryRepository(items); const api = services();
    store.events.push(
      { id: "hard-earlier", sessionId: "prior", phraseId: "latest-hard", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T01:00:00.000Z" },
      { id: "hard-later", sessionId: "prior", phraseId: "latest-hard", source: "due", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T02:00:00.000Z" },
      { id: "good-earlier", sessionId: "prior", phraseId: "latest-good", source: "due", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T01:00:00.000Z" },
      { id: "good-later", sessionId: "prior", phraseId: "latest-good", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T02:00:00.000Z" },
      { id: "tie-a", sessionId: "prior", phraseId: "tie-good", source: "due", result: "hard", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T03:00:00.000Z" },
      { id: "tie-z", sessionId: "prior", phraseId: "tie-good", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-09T03:00:00.000Z" },
    );

    renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "latest-result" }));
    await waitFor(() => expect(store.getSession()).toBeDefined());

    expect(store.getSession()?.phraseIds).toEqual(["latest-hard"]);
  });

  it("uses the Asia/Shanghai day boundary for latest-good exclusion", async () => {
    const items = [phrase("previous-day-good"), phrase("today-good")];
    const store = memoryRepository(items); const api = services();
    store.events.push(
      { id: "before-boundary", sessionId: "prior", phraseId: "previous-day-good", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-08T15:59:59.999Z" },
      { id: "at-boundary", sessionId: "prior", phraseId: "today-good", source: "due", result: "good", usedPronunciationHint: false, recorded: false, activeSeconds: 1, occurredAt: "2026-08-08T16:00:00.000Z" },
    );

    renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "shanghai-boundary" }));
    await waitFor(() => expect(store.getSession()).toBeDefined());

    expect(store.getSession()?.phraseIds).toEqual(["previous-day-good"]);
  });

  it("excludes the most recent completed Shanghai-day group with a stable session-id tie break", async () => {
    const items = Array.from({ length: 3 }, (_, index) => phrase(`recent-${index}`));
    const completedAt = "2026-08-09T02:00:00.000Z";
    const session = (id: string, phraseIds: string[]): TrainingSessionRecord => ({
      id, mode: "quick", startedAt: "2026-08-09T01:00:00.000Z", updatedAt: completedAt,
      completedAt, phraseIds, sources: phraseIds.map(() => "due"), currentIndex: phraseIds.length, activeSeconds: 10,
    });
    const store = memoryRepository(items, undefined, [
      session("completed-a", []),
      session("completed-z", items.map(({ id }) => id)),
    ]);

    renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...services(), seed: "recent-session" }));
    await waitFor(() => expect(store.getSession()?.id).not.toBe("completed-z"));

    expect(store.getSession()?.phraseIds).toEqual([]);
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

  it("does not append a requeue occurrence again when it is still unknown", async () => {
    const store = memoryRepository(); const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "requeue-once" }));
    await waitFor(() => expect(result.current.total).toBe(3));
    await act(() => result.current.revealAsUnknown());
    expect(result.current.total).toBe(4);
    await act(() => result.current.grade("hard"));
    await act(() => result.current.grade("hard"));
    await act(() => result.current.grade("hard"));
    expect(result.current.current?.source).toBe("requeue");
    await act(() => result.current.revealAsUnknown());
    expect(result.current.total).toBe(4);
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

  it("reveals for self assessment without saving a result until grading", async () => {
    const store = memoryRepository(Array.from({ length: 3 }, (_, index) => phrase(`self-${index}`)));
    const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "self" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    await act(() => result.current.revealForSelfAssessment());
    expect(result.current.phase).toBe("answer");
    expect(store.events).toHaveLength(0);
    await act(() => result.current.grade("hard"));
    expect(store.events).toHaveLength(1);
    expect(store.events[0].result).toBe("hard");
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

  it("never lets stalled automatic speech block reveal grading or recording grading", async () => {
    const never = new Promise<void>(() => undefined);

    const unknownStore = memoryRepository(); const unknownApi = services();
    unknownApi.speech.speak.mockImplementation(() => never);
    const unknown = renderHook(() => useTrainingSession({ repository: unknownStore.repository, mode: "quick", ...unknownApi, seed: "stalled-unknown" }));
    await waitFor(() => expect(unknown.result.current.current).toBeDefined());
    act(() => { void unknown.result.current.revealAsUnknown(); });
    await waitFor(() => expect(unknown.result.current.phase).toBe("answer"));
    await expect(act(() => unknown.result.current.grade("hard"))).resolves.toEqual({ accepted: true });
    expect(unknownApi.speech.cancel).toHaveBeenCalledOnce();
    expect(unknown.result.current.phase).toBe("prompt");
    unknown.unmount();

    const recordingStore = memoryRepository(); const recordingApi = services();
    recordingApi.speech.speak.mockImplementation(() => never);
    const recording = renderHook(() => useTrainingSession({ repository: recordingStore.repository, mode: "quick", ...recordingApi, seed: "stalled-recording" }));
    await waitFor(() => expect(recording.result.current.current).toBeDefined());
    await act(() => recording.result.current.startRecording());
    act(() => { void recording.result.current.stopRecording(); });
    await waitFor(() => expect(recording.result.current.phase).toBe("answer"));
    await expect(act(() => recording.result.current.grade("hard"))).resolves.toEqual({ accepted: true });
    recording.unmount();
  });

  it("resolves self-assessment reveal even when automatic speech stalls", async () => {
    const store = memoryRepository(); const api = services();
    api.speech.speak.mockImplementation(() => new Promise<void>(() => undefined));
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    let settled = false;
    act(() => { void result.current.revealForSelfAssessment().then(() => { settled = true; }); });
    await waitFor(() => expect(result.current.phase).toBe("answer"));
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(true);
  });

  it("starts automatic speech synchronously inside the reveal gesture", async () => {
    const store = memoryRepository(); const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api, seed: "ios-gesture" }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    api.speech.speak.mockClear();

    act(() => { void result.current.revealForSelfAssessment(); });

    expect(api.speech.speak).toHaveBeenCalledWith(result.current.current?.phrase.english, "en-US");
  });

  it("stops through a prompt-phase callback captured before recording starts", async () => {
    const store = memoryRepository(); const api = services();
    const { result } = renderHook(() => useTrainingSession({ repository: store.repository, mode: "quick", ...api }));
    await waitFor(() => expect(result.current.current).toBeDefined());
    const stopFromPressDownRender = result.current.stopRecording;
    await act(() => result.current.startRecording());
    await act(() => stopFromPressDownRender());
    expect(result.current.phase).toBe("answer");
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
