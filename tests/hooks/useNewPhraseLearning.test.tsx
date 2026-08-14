import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  Category,
  LearningSessionRecord,
  Phrase,
  PhraseLearningState,
  SpeechPreferences,
  TrainingEvent,
} from "../../app/domain/types";
import { applyLearningResult } from "../../app/domain/learningProgress";
import { useNewPhraseLearning } from "../../app/hooks/useNewPhraseLearning";
import type { PhraseRepository } from "../../app/storage/repository";

const timestamp = "2026-08-10T08:00:00.000Z";

const phrase = (id: string, overrides: Partial<Phrase> = {}): Phrase => ({
  id,
  english: `English ${id}`,
  chinese: `中文 ${id}`,
  categoryId: "daily",
  personalExample: "",
  sourceNote: "",
  reviewStep: 0,
  masteryLevel: 0,
  nextReviewAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  origin: "personal",
  kind: "standalone",
  ...overrides,
});

const category = (id: string): Category => ({
  id,
  name: id,
  isDefault: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const unseen = (phraseId: string): PhraseLearningState => ({
  phraseId,
  stage: "unseen",
  consecutiveGood: 0,
  masteredDates: [],
  updatedAt: timestamp,
});

const tested = (phraseId: string, firstTestedAt: string): PhraseLearningState => ({
  ...unseen(phraseId),
  stage: "learned",
  firstTestedAt,
  firstResult: "good",
});

interface MemoryOptions {
  phrases?: Phrase[];
  states?: PhraseLearningState[];
  categories?: Category[];
  active?: LearningSessionRecord;
  preferences?: SpeechPreferences;
}

function memoryRepository(options: MemoryOptions = {}) {
  const phrases = options.phrases ?? [];
  const states = structuredClone(options.states ?? []);
  const categories = options.categories ?? [category("daily")];
  const sessions = options.active ? [structuredClone(options.active)] : [];
  const events: TrainingEvent[] = [];
  const preferences = options.preferences ?? { accent: "en-US", autoSpeak: true };

  const repository = {
    listPhrases: vi.fn(async () => structuredClone(phrases)),
    listPhraseLearningStates: vi.fn(async () => structuredClone(states)),
    getActiveLearningSession: vi.fn(async () => structuredClone(sessions.find((item) => !item.completedAt))),
    listCategories: vi.fn(async () => structuredClone(categories)),
    getSpeechPreferences: vi.fn(async () => preferences),
    savePhraseLearningState: vi.fn(async (next: PhraseLearningState) => {
      const index = states.findIndex((item) => item.phraseId === next.phraseId);
      if (index >= 0) states[index] = structuredClone(next);
      else states.push(structuredClone(next));
    }),
    saveLearningSession: vi.fn(async (next: LearningSessionRecord) => {
      const index = sessions.findIndex((item) => item.id === next.id);
      if (index >= 0) sessions[index] = structuredClone(next);
      else sessions.push(structuredClone(next));
    }),
    submitFirstLearningReview: vi.fn(async (event: TrainingEvent, next: LearningSessionRecord) => {
      if (!events.some((item) => item.id === event.id)) {
        events.push(structuredClone(event));
        const stateIndex = states.findIndex((item) => item.phraseId === event.phraseId);
        const current = stateIndex >= 0 ? states[stateIndex] : unseen(event.phraseId);
        const progressed = applyLearningResult(current, event.result, new Date(event.occurredAt));
        const reviewed: PhraseLearningState = {
          ...progressed,
          firstSeenAt: current.firstSeenAt ?? event.occurredAt,
          firstTestedAt: current.firstTestedAt ?? event.occurredAt,
          firstResult: current.firstResult ?? event.result,
          updatedAt: event.occurredAt,
        };
        if (stateIndex >= 0) states[stateIndex] = structuredClone(reviewed);
        else states.push(structuredClone(reviewed));
      }
      const index = sessions.findIndex((item) => item.id === next.id);
      if (index >= 0 && sessions[index].testIndex < next.testIndex) sessions[index] = structuredClone(next);
    }),
    completeLearningSession: vi.fn(async (id: string, completedAt: Date) => {
      const session = sessions.find((item) => item.id === id);
      if (session) {
        session.completedAt = completedAt.toISOString();
        session.updatedAt = completedAt.toISOString();
      }
    }),
  } as unknown as PhraseRepository;

  return { repository, states, sessions, events };
}

function speech() {
  return {
    speak: vi.fn<(text: string, accent: "en-US" | "en-GB") => Promise<void>>(async () => undefined),
    cancel: vi.fn(),
  };
}

const renderLearning = (
  store: ReturnType<typeof memoryRepository>,
  voice = speech(),
  extra: Partial<Parameters<typeof useNewPhraseLearning>[0]> = {},
) => renderHook(() => useNewPhraseLearning({
  repository: store.repository,
  speech: voice,
  now: () => new Date(timestamp),
  idFactory: () => "learning-session",
  ...extra,
}));

describe("useNewPhraseLearning", () => {
  it("creates a dated five-phrase group with personal phrases first and a stable system theme", async () => {
    const items = [
      phrase("daily-core", { origin: "system", kind: "core" }),
      phrase("work-core", { origin: "system", kind: "core", categoryId: "work" }),
      phrase("travel-core", { origin: "system", kind: "core", categoryId: "travel" }),
      phrase("personal-old", { createdAt: "2026-08-08T00:00:00.000Z" }),
      phrase("personal-new", { createdAt: "2026-08-09T00:00:00.000Z", categoryId: "personal" }),
      phrase("extra-core", { origin: "system", kind: "core", categoryId: "work" }),
    ];
    const store = memoryRepository({
      phrases: items,
      states: items.map((item) => unseen(item.id)),
      categories: [category("travel"), category("daily"), category("work")],
    });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    expect(hook.result.current.total).toBe(5);
    expect(store.sessions[0]).toMatchObject({
      id: "learning-session",
      date: "2026-08-10",
      phase: "study",
      studyIndex: 0,
      testIndex: 0,
    });
    expect(store.sessions[0].phraseIds.slice(0, 2)).toEqual(["personal-new", "personal-old"]);
    expect(store.sessions[0].themeCategoryId).toBe("work");
    expect(hook.result.current.current?.id).toBe("personal-new");
  });

  it("returns a short group and reports empty without saving an invalid session", async () => {
    const shortItems = [phrase("one"), phrase("two")];
    const shortStore = memoryRepository({ phrases: shortItems, states: shortItems.map((item) => unseen(item.id)) });
    const short = renderLearning(shortStore);
    await waitFor(() => expect(short.result.current.phase).toBe("study"));
    expect(short.result.current.total).toBe(2);

    const emptyStore = memoryRepository({ phrases: [], states: [] });
    const empty = renderLearning(emptyStore);
    await waitFor(() => expect(empty.result.current.phase).toBe("empty"));
    expect(emptyStore.repository.saveLearningSession).not.toHaveBeenCalled();
  });

  it("creates five new phrases even when fifteen other phrases were first tested today", async () => {
    const items = Array.from({ length: 7 }, (_, index) => phrase(`new-${index}`));
    const store = memoryRepository({
      phrases: items,
      states: [
        ...Array.from({ length: 15 }, (_, index) => tested(`learned-${index}`, timestamp)),
        ...items.map((item) => unseen(item.id)),
      ],
    });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.phase).toBe("study"));
    expect(hook.result.current.total).toBe(5);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].phraseIds).toHaveLength(5);
    expect(store.repository.saveLearningSession).toHaveBeenCalledWith(
      expect.objectContaining({ phraseIds: expect.any(Array) }),
    );
    expect((store.repository.saveLearningSession as ReturnType<typeof vi.fn>).mock.calls[0][0].phraseIds).toHaveLength(5);
  });

  it("restores an active group even when twenty other phrases were first tested today", async () => {
    const items = [phrase("a"), phrase("b")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: items.map((item) => item.id),
      studyIndex: 1, testIndex: 0, phase: "study", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({
      phrases: items,
      states: [
        ...Array.from({ length: 20 }, (_, index) => tested(`learned-${index}`, timestamp)),
        ...items.map((item) => unseen(item.id)),
      ],
      active,
    });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.current?.id).toBe("b"));
    expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 1, total: 2 });
    expect(store.repository.saveLearningSession).not.toHaveBeenCalled();
  });

  it("shows two ordered examples, marks unseen study state, and auto-speaks without waiting", async () => {
    const never = new Promise<void>(() => undefined);
    const core = phrase("core", { origin: "system", kind: "core" });
    const items = [
      core,
      phrase("example-3", { origin: "system", kind: "example", parentPhraseId: core.id, unlockOrder: 3 }),
      phrase("example-1", { origin: "system", kind: "example", parentPhraseId: core.id, unlockOrder: 1 }),
      phrase("example-2", { origin: "system", kind: "example", parentPhraseId: core.id, unlockOrder: 2 }),
    ];
    const store = memoryRepository({ phrases: items, states: [unseen(core.id)] });
    const voice = speech();
    voice.speak.mockImplementation(() => never);
    const hook = renderLearning(store, voice);

    await waitFor(() => expect(hook.result.current.current?.id).toBe(core.id));
    expect(hook.result.current.examples.map((item) => item.id)).toEqual(["example-1", "example-2"]);
    await waitFor(() => expect(store.states.find((item) => item.phraseId === core.id)?.stage).toBe("learning"));
    expect(voice.speak).toHaveBeenCalledWith(core.english, "en-US");
    expect(hook.result.current.busy).toBe(false);
  });

  it("never exposes study examples through the controller during test", async () => {
    const core = phrase("core", { origin: "system", kind: "core" });
    const example = phrase("example", {
      origin: "system", kind: "example", parentPhraseId: core.id, unlockOrder: 1,
    });
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: [core.id],
      studyIndex: 1, testIndex: 0, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: [core, example], states: [unseen(core.id)], active });
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("test"));

    expect(hook.result.current.examples).toEqual([]);
    await act(() => hook.result.current.reveal());
    expect(hook.result.current.examples).toEqual([]);
  });

  it("persists all study cursors before testing and creates no review event during study", async () => {
    const items = Array.from({ length: 5 }, (_, index) => phrase(`p-${index}`));
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    for (let index = 0; index < 5; index += 1) await act(() => hook.result.current.nextStudyPhrase());

    expect(store.repository.submitFirstLearningReview).not.toHaveBeenCalled();
    expect(store.events).toHaveLength(0);
    expect(hook.result.current).toMatchObject({ phase: "test", studyIndex: 5, testIndex: 0, revealed: false });
    expect(hook.result.current.current?.id).toBe(store.sessions[0].phraseIds[0]);
  });

  it.each([
    { result: "good" as const, masteredDates: ["2026-08-11"], consecutiveGood: 1 },
    { result: "hard" as const, masteredDates: [], consecutiveGood: 0 },
    { result: "again" as const, masteredDates: [], consecutiveGood: 0 },
  ])("persists the repository-owned first-learning state for $result", async ({ result, masteredDates, consecutiveGood }) => {
    const item = phrase(`first-${result}`);
    const reviewAt = "2026-08-10T16:05:00.000Z";
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    const hook = renderLearning(store, speech(), { now: () => new Date(reviewAt) });
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    await act(() => hook.result.current.nextStudyPhrase());
    expect(hook.result.current).toMatchObject({ phase: "test", testIndex: 0, revealed: false });
    expect(hook.result.current.current).toMatchObject({ english: item.english, chinese: item.chinese });
    await act(() => hook.result.current.reveal());
    await act(() => hook.result.current.grade(result));

    expect(store.states.find((state) => state.phraseId === item.id)).toMatchObject({
      stage: "learned",
      firstTestedAt: reviewAt,
      firstResult: result,
      masteredDates,
      consecutiveGood,
    });
    expect(store.states.find((state) => state.phraseId === item.id)?.stage).not.toBe("mastered");
  });

  it("reuses a committed good event after a lost acknowledgement without adding a same-day mastery date", async () => {
    const item = phrase("idempotent-good");
    const reviewAt = "2026-08-10T16:05:00.000Z";
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-11", themeCategoryId: "daily", phraseIds: [item.id],
      studyIndex: 1, testIndex: 0, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)], active });
    const submit = store.repository.submitFirstLearningReview as ReturnType<typeof vi.fn>;
    const persist = submit.getMockImplementation()!;
    submit.mockImplementationOnce(async (event: TrainingEvent, next: LearningSessionRecord) => {
      await persist(event, next);
      throw new Error("lost acknowledgement");
    });
    const hook = renderLearning(store, speech(), { now: () => new Date(reviewAt) });
    await waitFor(() => expect(hook.result.current.phase).toBe("test"));
    await act(() => hook.result.current.reveal());

    await act(() => hook.result.current.grade("good"));
    expect(hook.result.current).toMatchObject({ phase: "test", testIndex: 0, revealed: true });
    const committedEvent = structuredClone(submit.mock.calls[0][0]);
    await act(() => hook.result.current.grade("good"));

    expect(submit.mock.calls[1][0]).toEqual(committedEvent);
    expect(store.events).toHaveLength(1);
    expect(store.states.find((state) => state.phraseId === item.id)).toMatchObject({
      stage: "learned", masteredDates: ["2026-08-11"], consecutiveGood: 1,
    });
  });

  it("requires reveal, keeps the answer visible until atomic grade commits, and guards double clicks", async () => {
    const items = [phrase("first"), phrase("second")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: items.map((item) => item.id),
      studyIndex: 2, testIndex: 0, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => { release = resolve; });
    const submit = store.repository.submitFirstLearningReview as ReturnType<typeof vi.fn>;
    submit.mockImplementationOnce(async () => deferred);
    const voice = speech();
    const hook = renderLearning(store, voice);
    await waitFor(() => expect(hook.result.current.phase).toBe("test"));

    expect(voice.speak).not.toHaveBeenCalled();
    await act(() => hook.result.current.replay());
    expect(voice.speak).not.toHaveBeenCalled();
    await act(() => hook.result.current.grade("good"));
    expect(submit).not.toHaveBeenCalled();
    act(() => { void hook.result.current.reveal(); });
    expect(hook.result.current.revealed).toBe(true);
    expect(voice.speak).toHaveBeenCalledWith("English first", "en-US");
    act(() => { void hook.result.current.grade("good"); void hook.result.current.grade("hard"); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(hook.result.current.current?.id).toBe("first");
    expect(hook.result.current.testIndex).toBe(0);

    release();
    await waitFor(() => expect(hook.result.current.current?.id).toBe("second"));
    expect(hook.result.current.revealed).toBe(false);
  });

  it("retries a failed atomic grade with the same event and does not advance early", async () => {
    const item = phrase("only");
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: [item.id],
      studyIndex: 1, testIndex: 0, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)], active });
    const submit = store.repository.submitFirstLearningReview as ReturnType<typeof vi.fn>;
    submit.mockRejectedValueOnce(new Error("offline"));
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("test"));
    await act(() => hook.result.current.reveal());

    await act(() => hook.result.current.grade("hard"));
    expect(hook.result.current).toMatchObject({ phase: "test", testIndex: 0, revealed: true });
    expect(hook.result.current.error).toContain("保存");
    const firstEvent = structuredClone(submit.mock.calls[0][0]);

    await act(() => hook.result.current.grade("hard"));
    expect(submit.mock.calls[1][0]).toEqual(firstEvent);
    expect(firstEvent).toMatchObject({
      sessionId: "active", phraseId: "only", source: "new", result: "hard",
      usedPronunciationHint: false, recorded: false, activeSeconds: 0,
    });
    expect(JSON.stringify(firstEvent)).not.toContain("Blob");
    expect(hook.result.current.phase).toBe("complete");
  });

  it("completes only after the final atomic review and completion write both succeed", async () => {
    const item = phrase("only");
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: [item.id],
      studyIndex: 1, testIndex: 0, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)], active });
    const complete = store.repository.completeLearningSession as ReturnType<typeof vi.fn>;
    complete.mockRejectedValueOnce(new Error("completion failed"));
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("test"));
    await act(() => hook.result.current.reveal());

    await act(() => hook.result.current.grade("good"));
    expect(hook.result.current.phase).toBe("test");
    expect(hook.result.current.error).toContain("完成");
    expect(store.repository.submitFirstLearningReview).toHaveBeenCalledTimes(1);

    await act(() => hook.result.current.grade("good"));
    expect(store.repository.submitFirstLearningReview).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(hook.result.current.phase).toBe("complete");
  });

  it.each([
    { phase: "study" as const, studyIndex: 1, testIndex: 0, current: "b" },
    { phase: "test" as const, studyIndex: 3, testIndex: 1, current: "b" },
  ])("restores the exact active $phase queue and cursor without selecting again", async (saved) => {
    const items = [phrase("a"), phrase("b"), phrase("c"), phrase("unused")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-09", themeCategoryId: "saved-theme", phraseIds: ["a", "b", "c"],
      studyIndex: saved.studyIndex, testIndex: saved.testIndex, phase: saved.phase,
      startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.current?.id).toBe(saved.current));
    expect(hook.result.current.total).toBe(3);
    expect(store.repository.saveLearningSession).not.toHaveBeenCalled();
    expect(store.sessions[0].themeCategoryId).toBe("saved-theme");
  });

  it("remounts at the exact test cursor with the English answer hidden again", async () => {
    const items = [phrase("first"), phrase("second"), phrase("third")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: items.map((item) => item.id),
      studyIndex: 3, testIndex: 1, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    const firstVoice = speech();
    const first = renderLearning(store, firstVoice);
    await waitFor(() => expect(first.result.current.current?.id).toBe("second"));
    await act(() => first.result.current.reveal());
    expect(first.result.current.revealed).toBe(true);
    first.unmount();

    const resumedVoice = speech();
    const resumed = renderLearning(store, resumedVoice);
    await waitFor(() => expect(resumed.result.current.current?.id).toBe("second"));

    expect(resumed.result.current).toMatchObject({ phase: "test", studyIndex: 3, testIndex: 1, revealed: false });
    expect(resumedVoice.speak).not.toHaveBeenCalled();
  });

  it.each([
    { label: "before", ids: ["missing", "a", "b"], cursor: 2, expected: "b", normalized: 1 },
    { label: "current", ids: ["a", "missing", "b"], cursor: 1, expected: "b", normalized: 1 },
  ])("normalizes a deleted phrase $label the saved study cursor", async ({ ids, cursor, expected, normalized }) => {
    const items = [phrase("a"), phrase("b")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: ids,
      studyIndex: cursor, testIndex: 0, phase: "study", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.current?.id).toBe(expected));
    expect(hook.result.current.studyIndex).toBe(normalized);
    await waitFor(() => expect(store.sessions[0].phraseIds).toEqual(["a", "b"]));
  });

  it("finishes an already evaluated test boundary during resume", async () => {
    const item = phrase("done");
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: [item.id],
      studyIndex: 1, testIndex: 1, phase: "test", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)], active });
    const hook = renderLearning(store);

    await waitFor(() => expect(hook.result.current.phase).toBe("complete"));
    expect(store.repository.completeLearningSession).toHaveBeenCalledWith("active", new Date(timestamp));
    expect(store.repository.submitFirstLearningReview).not.toHaveBeenCalled();
  });

  it("surfaces initialization and initial-save failures and retry starts a fresh generation", async () => {
    const item = phrase("retry");
    const listFailure = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    const list = listFailure.repository.listPhrases as ReturnType<typeof vi.fn>;
    list.mockRejectedValueOnce(new Error("db down"));
    const first = renderLearning(listFailure);
    await waitFor(() => expect(first.result.current.phase).toBe("error"));
    act(() => first.result.current.retry());
    await waitFor(() => expect(first.result.current.phase).toBe("study"));
    expect(list).toHaveBeenCalledTimes(2);

    const saveFailure = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    const save = saveFailure.repository.saveLearningSession as ReturnType<typeof vi.fn>;
    save.mockRejectedValueOnce(new Error("write down"));
    const second = renderLearning(saveFailure);
    await waitFor(() => expect(second.result.current.phase).toBe("error"));
    expect(second.result.current.current).toBeUndefined();
    act(() => second.result.current.retry());
    await waitFor(() => expect(second.result.current.phase).toBe("study"));
  });

  it("serializes retry behind an in-flight initial session creation", async () => {
    const items = [phrase("first"), phrase("second")];
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const save = store.repository.saveLearningSession as ReturnType<typeof vi.fn>;
    const persist = save.getMockImplementation()!;
    let releaseCreation!: () => void;
    const deferredCreation = new Promise<void>((resolve) => { releaseCreation = resolve; });
    save.mockImplementationOnce(async (session: LearningSessionRecord) => {
      await deferredCreation;
      await persist(session);
    });
    const ids = vi.fn()
      .mockReturnValueOnce("first-session")
      .mockReturnValueOnce("second-session");
    const voice = speech();
    const hook = renderHook(() => useNewPhraseLearning({
      repository: store.repository,
      speech: voice,
      now: () => new Date(timestamp),
      idFactory: ids,
    }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    act(() => hook.result.current.retry());
    await waitFor(() => expect(store.repository.getActiveLearningSession).toHaveBeenCalledTimes(2));
    releaseCreation();
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));
    await act(async () => { await Promise.resolve(); });

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe("first-session");
    expect(save).toHaveBeenCalledTimes(1);
    expect(ids).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a settled creation snapshot after completion and retry", async () => {
    const item = phrase("only");
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));
    await act(() => hook.result.current.nextStudyPhrase());
    await act(() => hook.result.current.reveal());
    await act(() => hook.result.current.grade("good"));
    expect(hook.result.current.phase).toBe("complete");

    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.phase).toBe("empty"));

    expect(hook.result.current.total).toBe(0);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].completedAt).toBeDefined();
  });

  it("starts another group from newly added unseen phrases after completion", async () => {
    const first = phrase("first");
    const items = [first];
    const store = memoryRepository({ phrases: items, states: [unseen(first.id)] });
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));
    await act(() => hook.result.current.nextStudyPhrase());
    await act(() => hook.result.current.reveal());
    await act(() => hook.result.current.grade("good"));
    expect(hook.result.current.phase).toBe("complete");

    const second = phrase("second");
    items.push(second);
    store.states.push(unseen(second.id));
    act(() => hook.result.current.retry());

    await waitFor(() => expect(hook.result.current.current?.id).toBe(second.id));
    expect(hook.result.current).toMatchObject({
      phase: "study",
      current: second,
      studyIndex: 0,
      total: 1,
    });
  });

  it("takes over a never-settling initial creation and ignores its late conflict", async () => {
    const items = [phrase("first"), phrase("second")];
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const save = store.repository.saveLearningSession as ReturnType<typeof vi.fn>;
    const persist = save.getMockImplementation()!;
    let releaseOld!: () => void;
    const neverUntilReleased = new Promise<void>((resolve) => { releaseOld = resolve; });
    save.mockImplementationOnce(async (session: LearningSessionRecord) => {
      await neverUntilReleased;
      if (store.sessions.some((item) => !item.completedAt)) throw new Error("已有进行中的学习会话");
      await persist(session);
    });
    const ids = vi.fn()
      .mockReturnValueOnce("stalled-session")
      .mockReturnValueOnce("replacement-session");
    const voice = speech();
    const hook = renderHook(() => useNewPhraseLearning({
      repository: store.repository,
      speech: voice,
      now: () => new Date(timestamp),
      idFactory: ids,
    }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    expect(hook.result.current.busy).toBe(false);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe("replacement-session");
    expect(save).toHaveBeenCalledTimes(2);
    releaseOld();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(store.sessions).toHaveLength(1);
    expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 0, busy: false });
  });

  it("keeps speech failures non-blocking and replay reports a Chinese error", async () => {
    const items = [phrase("first"), phrase("second")];
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const voice = speech();
    voice.speak.mockRejectedValue(new Error("unsupported"));
    const hook = renderLearning(store, voice);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    await act(() => hook.result.current.replay());
    expect(hook.result.current.error).toMatch(/[\u4e00-\u9fff]/);
    await act(() => hook.result.current.nextStudyPhrase());
    expect(hook.result.current.studyIndex).toBe(1);
  });

  it("cancels speech on unmount and ignores late initialization", async () => {
    const item = phrase("late");
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    let release!: (value: Phrase[]) => void;
    const deferred = new Promise<Phrase[]>((resolve) => { release = resolve; });
    (store.repository.listPhrases as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferred);
    const voice = speech();
    const hook = renderLearning(store, voice);
    hook.unmount();
    await act(async () => { release([item]); await deferred; });

    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(store.repository.saveLearningSession).not.toHaveBeenCalled();
    expect(store.repository.savePhraseLearningState).not.toHaveBeenCalled();
  });

  it("keeps a retried initialization busy and visible while an old study advance finishes", async () => {
    const items = [phrase("first"), phrase("second")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: items.map((item) => item.id),
      studyIndex: 0, testIndex: 0, phase: "study", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    const hook = renderLearning(store);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    let releaseSave!: () => void;
    const deferredSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    (store.repository.saveLearningSession as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferredSave);
    let releaseReload!: (value: Phrase[]) => void;
    const deferredReload = new Promise<Phrase[]>((resolve) => { releaseReload = resolve; });
    (store.repository.listPhrases as ReturnType<typeof vi.fn>).mockImplementationOnce(() => deferredReload);

    let advancing!: Promise<void>;
    act(() => { advancing = hook.result.current.nextStudyPhrase(); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.phase).toBe("loading"));

    releaseSave();
    await act(() => advancing);
    expect(hook.result.current).toMatchObject({ phase: "loading", studyIndex: 0, busy: true });

    releaseReload(items);
    await waitFor(() => expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 0, busy: false }));
  });

  it("ignores a stale replay rejection after retry loads a new generation", async () => {
    const item = phrase("first");
    const store = memoryRepository({ phrases: [item], states: [unseen(item.id)] });
    const voice = speech();
    const hook = renderLearning(store, voice);
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));
    voice.speak.mockClear();

    let rejectReplay!: (reason: Error) => void;
    const deferredReplay = new Promise<void>((_resolve, reject) => { rejectReplay = reject; });
    voice.speak.mockImplementationOnce(() => deferredReplay);
    const replaying = hook.result.current.replay();
    act(() => hook.result.current.retry());
    await waitFor(() => expect(store.repository.getActiveLearningSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.phase).toBe("study"));

    await act(async () => { rejectReplay(new Error("old speech failed")); await replaying; });
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.busy).toBe(false);
  });

  it("keeps stale learning-state writes from contaminating a replacement repository", async () => {
    const items = [phrase("first"), phrase("second")];
    const oldStore = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const newStore = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const oldSave = oldStore.repository.savePhraseLearningState as ReturnType<typeof vi.fn>;
    let rejectOld!: (reason: Error) => void;
    const deferredOld = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    oldSave.mockImplementationOnce(() => deferredOld);
    const newSave = newStore.repository.savePhraseLearningState as ReturnType<typeof vi.fn>;
    const persistNew = newSave.getMockImplementation()!;
    let releaseNew!: () => void;
    const deferredNew = new Promise<void>((resolve) => { releaseNew = resolve; });
    newSave.mockImplementationOnce(async (state: PhraseLearningState) => {
      await deferredNew;
      await persistNew(state);
    });
    const voice = speech();
    const { result, rerender } = renderHook(
      ({ repository }) => useNewPhraseLearning({
        repository,
        speech: voice,
        now: () => new Date(timestamp),
        idFactory: () => "session",
      }),
      { initialProps: { repository: oldStore.repository } },
    );
    await waitFor(() => expect(oldSave).toHaveBeenCalledTimes(1));

    rerender({ repository: newStore.repository });
    await waitFor(() => expect(newSave).toHaveBeenCalledTimes(1));
    await act(async () => { rejectOld(new Error("old repository failed")); await Promise.resolve(); });
    const staleError = result.current.error;

    let advancing!: Promise<void>;
    act(() => { advancing = result.current.nextStudyPhrase(); });
    releaseNew();
    await act(() => advancing);

    expect(staleError).toBeUndefined();
    expect(newSave.mock.calls.filter(([state]) => state.phraseId === "first")).toHaveLength(1);
    expect(newStore.states.find((state) => state.phraseId === "first")).toMatchObject({
      stage: "learning", firstSeenAt: timestamp,
    });
    expect(result.current).toMatchObject({ phase: "study", studyIndex: 1, error: undefined });
  });

  it("restarts a never-settling learning-state put for a newer generation on the same repository", async () => {
    const items = [phrase("first"), phrase("second")];
    const active: LearningSessionRecord = {
      id: "active", date: "2026-08-10", themeCategoryId: "daily", phraseIds: items.map((item) => item.id),
      studyIndex: 0, testIndex: 0, phase: "study", startedAt: timestamp, updatedAt: timestamp,
    };
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)), active });
    const saveState = store.repository.savePhraseLearningState as ReturnType<typeof vi.fn>;
    let releaseOld!: () => void;
    const oldWrite = new Promise<void>((resolve) => { releaseOld = resolve; });
    saveState.mockImplementationOnce(() => oldWrite);
    let actionTime = "2026-08-10T08:00:00.000Z";
    const voice = speech();
    const hook = renderHook(() => useNewPhraseLearning({
      repository: store.repository,
      speech: voice,
      now: () => new Date(actionTime),
      idFactory: () => "unused",
    }));
    await waitFor(() => expect(saveState).toHaveBeenCalledTimes(1));

    actionTime = "2026-08-10T09:00:00.000Z";
    act(() => hook.result.current.retry());
    await waitFor(() => expect(saveState).toHaveBeenCalledTimes(2));
    await act(() => hook.result.current.nextStudyPhrase());

    expect(hook.result.current).toMatchObject({ phase: "study", studyIndex: 1, busy: false });
    expect(saveState.mock.calls.filter(([state]) => state.phraseId === "first")).toHaveLength(2);
    expect(saveState.mock.calls[1][0]).toMatchObject({ firstSeenAt: "2026-08-10T09:00:00.000Z" });
    releaseOld();
    await act(async () => { await Promise.resolve(); });
    expect(store.states.find((state) => state.phraseId === "first")).toMatchObject({
      stage: "learning", firstSeenAt: "2026-08-10T09:00:00.000Z",
    });
  });

  it("does not reinitialize for an inline clock and actions use the latest clock", async () => {
    const items = [phrase("first"), phrase("second")];
    const store = memoryRepository({ phrases: items, states: items.map((item) => unseen(item.id)) });
    const voice = speech();
    const { result, rerender } = renderHook(
      ({ clock }) => useNewPhraseLearning({
        repository: store.repository,
        speech: voice,
        now: clock,
        idFactory: () => "stable",
      }),
      { initialProps: { clock: () => new Date("2026-08-10T08:00:00.000Z") } },
    );
    await waitFor(() => expect(result.current.phase).toBe("study"));

    rerender({ clock: () => new Date("2026-08-10T09:00:00.000Z") });
    await act(() => result.current.nextStudyPhrase());

    expect(store.repository.getActiveLearningSession).toHaveBeenCalledTimes(1);
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].updatedAt).toBe("2026-08-10T09:00:00.000Z");
  });
});
