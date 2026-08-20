"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { countNewPhrasesOnShanghaiDay, shanghaiDayBounds } from "../domain/dailyTask";
import { previewLearningGroup } from "../domain/learningSelection";
import type {
  LearningSessionPurpose,
  LearningSessionRecord,
  Phrase,
  PhraseLearningState,
  ReviewResult,
  SpeechPreferences,
  TrainingEvent,
} from "../domain/types";
import { DEFAULT_DAILY_NEW_PHRASE_GOAL } from "../domain/types";
import type { BrowserSpeechService } from "../services/speech";
import type { PhraseRepository } from "../storage/repository";

export type NewLearningPhase = "loading" | "study" | "test" | "complete" | "goal-complete" | "empty" | "error";

export interface NewPhraseLearningController {
  purpose: LearningSessionPurpose;
  sessionId?: string;
  phase: NewLearningPhase;
  current?: Phrase;
  examples: Phrase[];
  studyIndex: number;
  testIndex: number;
  total: number;
  revealed: boolean;
  error?: string;
  busy: boolean;
  dailyRemaining: number;
  replay(): Promise<void>;
  nextStudyPhrase(): Promise<void>;
  reveal(): Promise<void>;
  grade(result: ReviewResult): Promise<void>;
  retry(): void;
}

export interface UseNewPhraseLearningOptions {
  repository: PhraseRepository;
  speech: Pick<BrowserSpeechService, "speak" | "cancel">;
  purpose: LearningSessionPurpose;
  dailyGoal?: number;
  now?: () => Date;
  idFactory?: () => string;
}

interface PendingReview {
  event: TrainingEvent;
  nextSession: LearningSessionRecord;
}

interface LearningStateWrite {
  repository: PhraseRepository;
  generation: number;
  state: PhraseLearningState;
  promise: Promise<void>;
}

interface SessionCreation {
  repository: PhraseRepository;
  purpose: LearningSessionPurpose;
  promise: Promise<LearningSessionRecord>;
}

type CreationWindowResult =
  | { status: "saved" }
  | { status: "failed" }
  | { status: "timeout" };

const systemNow = () => new Date();
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const defaultPreferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };
const CREATION_COORDINATION_MS = 200;

function waitForCreationWindow(promise: Promise<LearningSessionRecord>): Promise<CreationWindowResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CreationWindowResult) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(result);
    };
    const timer = globalThis.setTimeout(() => finish({ status: "timeout" }), CREATION_COORDINATION_MS);
    void promise.then(
      () => finish({ status: "saved" }),
      () => finish({ status: "failed" }),
    );
  });
}

function shanghaiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function shanghaiDayRange(date: string): { from: Date; to: Date } {
  const { startInclusive, endExclusive } = shanghaiDayBounds(date);
  return {
    from: new Date(startInclusive),
    to: new Date(Date.parse(endExclusive) - 1),
  };
}

function cursorAfterFiltering(ids: string[], cursor: number, survivingIds: Set<string>): number {
  return ids.slice(0, Math.min(cursor, ids.length)).filter((id) => survivingIds.has(id)).length;
}

function sameSessionProgress(left: LearningSessionRecord, right: LearningSessionRecord): boolean {
  return left.phase === right.phase
    && left.studyIndex === right.studyIndex
    && left.testIndex === right.testIndex
    && left.phraseIds.length === right.phraseIds.length
    && left.phraseIds.every((id, index) => id === right.phraseIds[index]);
}

export function useNewPhraseLearning({
  repository,
  speech,
  purpose,
  dailyGoal = DEFAULT_DAILY_NEW_PHRASE_GOAL,
  now = systemNow,
  idFactory = createId,
}: UseNewPhraseLearningOptions): NewPhraseLearningController {
  const [phase, setPhase] = useState<NewLearningPhase>("loading");
  const [sessionId, setSessionId] = useState<string>();
  const [queue, setQueue] = useState<Phrase[]>([]);
  const [allPhrases, setAllPhrases] = useState<Phrase[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [testIndex, setTestIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [dailyRemaining, setDailyRemaining] = useState(0);

  const phaseRef = useRef<NewLearningPhase>("loading");
  const queueRef = useRef<Phrase[]>([]);
  const studyIndexRef = useRef(0);
  const testIndexRef = useRef(0);
  const revealedRef = useRef(false);
  const sessionRef = useRef<LearningSessionRecord | undefined>(undefined);
  const learningStatesRef = useRef(new Map<string, PhraseLearningState>());
  const stateWritesRef = useRef(new Map<string, LearningStateWrite>());
  const sessionCreationRef = useRef<SessionCreation | undefined>(undefined);
  const preferencesRef = useRef<SpeechPreferences>(defaultPreferences);
  const pendingReviewRef = useRef<PendingReview | undefined>(undefined);
  const operationRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const nowRef = useRef(now);
  const idFactoryRef = useRef(idFactory);
  const repositoryRef = useRef(repository);

  useEffect(() => {
    nowRef.current = now;
    idFactoryRef.current = idFactory;
    repositoryRef.current = repository;
  }, [idFactory, now, repository]);

  const readNow = useCallback(() => nowRef.current(), []);
  const readId = useCallback(() => idFactoryRef.current(), []);

  const replacePhase = useCallback((next: NewLearningPhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const replaceQueue = useCallback((next: Phrase[]) => {
    queueRef.current = next;
    if (mountedRef.current) setQueue(next);
  }, []);

  const replaceStudyIndex = useCallback((next: number) => {
    studyIndexRef.current = next;
    if (mountedRef.current) setStudyIndex(next);
  }, []);

  const replaceTestIndex = useCallback((next: number) => {
    testIndexRef.current = next;
    if (mountedRef.current) setTestIndex(next);
  }, []);

  const replaceRevealed = useCallback((next: boolean) => {
    revealedRef.current = next;
    if (mountedRef.current) setRevealed(next);
  }, []);

  const replaceDailyRemaining = useCallback((next: number) => {
    if (mountedRef.current) setDailyRemaining(next);
  }, []);

  const setVisibleError = useCallback((message?: string) => {
    if (mountedRef.current) setError(message);
  }, []);

  const setOperation = useCallback((active: boolean) => {
    operationRef.current = active;
    if (mountedRef.current) setBusy(active);
  }, []);

  const ensureLearningState = useCallback((item: Phrase): Promise<void> => {
    const generation = generationRef.current;
    const current = learningStatesRef.current.get(item.id);
    if (current && current.stage !== "unseen") return Promise.resolve();

    const trackWrite = (state: PhraseLearningState, source: Promise<void>): Promise<void> => {
      const entry = {} as LearningStateWrite;
      const promise = source.then(() => {
        if (generation === generationRef.current && repositoryRef.current === repository) {
          learningStatesRef.current.set(item.id, state);
          if (stateWritesRef.current.get(item.id) === entry) stateWritesRef.current.delete(item.id);
        }
      }).catch((cause) => {
        if (stateWritesRef.current.get(item.id) === entry) stateWritesRef.current.delete(item.id);
        throw cause;
      });
      Object.assign(entry, { repository, generation, state, promise });
      stateWritesRef.current.set(item.id, entry);
      return promise;
    };

    const existingWrite = stateWritesRef.current.get(item.id);
    if (existingWrite?.repository === repository && existingWrite.generation === generation) {
      return existingWrite.promise;
    }

    const updatedAt = readNow().toISOString();
    const next: PhraseLearningState = {
      phraseId: item.id,
      stage: "learning",
      firstSeenAt: current?.firstSeenAt ?? updatedAt,
      consecutiveGood: 0,
      masteredDates: current?.masteredDates ?? [],
      unlockedAt: current?.unlockedAt,
      updatedAt,
    };
    return trackWrite(next, repository.savePhraseLearningState(next));
  }, [readNow, repository]);

  const initialize = useCallback(() => {
    const generation = ++generationRef.current;
    const creationAtStart = sessionCreationRef.current;
    const started = readNow();
    const date = shanghaiDate(started);
    const dailyRange = purpose === "daily" ? shanghaiDayRange(date) : undefined;
    pendingReviewRef.current = undefined;
    sessionRef.current = undefined;
    if (mountedRef.current) setSessionId(undefined);
    setOperation(true);
    setVisibleError(undefined);
    replacePhase("loading");
    replaceQueue([]);
    if (mountedRef.current) setAllPhrases([]);
    replaceStudyIndex(0);
    replaceTestIndex(0);
    replaceRevealed(false);
    replaceDailyRemaining(0);

    void (async () => {
      const otherPurpose: LearningSessionPurpose = purpose === "daily" ? "autonomous" : "daily";
      const [phrases, states, initialActive, otherActive, categories, preferences, dailyEvents] = await Promise.all([
        repository.listPhrases(),
        repository.listPhraseLearningStates(),
        repository.getActiveLearningSession(purpose),
        repository.getActiveLearningSession(otherPurpose),
        repository.listCategories(),
        repository.getSpeechPreferences().catch(() => defaultPreferences),
        dailyRange ? repository.listTrainingEvents(dailyRange.from, dailyRange.to) : Promise.resolve([]),
      ]);
      if (!mountedRef.current || generation !== generationRef.current) return;
      setAllPhrases(phrases);
      learningStatesRef.current = new Map(states.map((state) => [state.phraseId, state]));
      preferencesRef.current = preferences;
      const remaining = purpose === "daily"
        ? Math.max(0, dailyGoal - countNewPhrasesOnShanghaiDay(dailyEvents, date))
        : 0;
      replaceDailyRemaining(remaining);

      let active = initialActive;
      const pendingCreation = creationAtStart;
      if (!active && pendingCreation?.repository === repository && pendingCreation.purpose === purpose) {
        const result = await waitForCreationWindow(pendingCreation.promise);
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (result.status !== "timeout") {
          active = await repository.getActiveLearningSession(purpose);
          if (!mountedRef.current || generation !== generationRef.current) return;
        }
      }

      const restoreActive = async (saved: LearningSessionRecord) => {
        const savedPurpose = saved.purpose ?? "autonomous";
        if (savedPurpose !== purpose) throw new Error("学习会话用途不匹配");
        const byId = new Map(phrases.map((item) => [item.id, item]));
        const restoredWithPositions = saved.phraseIds.flatMap((id, position) => {
          const item = byId.get(id);
          return item ? [{ item, position }] : [];
        });
        if (restoredWithPositions.length === 0) {
          throw new Error("学习内容已被删除");
        }
        const restored = restoredWithPositions.map(({ item }) => item);
        const survivingIds = new Set(restored.map((item) => item.id));
        let normalizedStudy = cursorAfterFiltering(saved.phraseIds, saved.studyIndex, survivingIds);
        let normalizedTest = cursorAfterFiltering(saved.phraseIds, saved.testIndex, survivingIds);
        let normalizedPhase = saved.phase;
        if (normalizedPhase === "study" && normalizedStudy >= restored.length) {
          normalizedStudy = restored.length;
          normalizedTest = 0;
          normalizedPhase = "test";
        } else if (normalizedPhase === "test") {
          normalizedStudy = restored.length;
          normalizedTest = Math.min(normalizedTest, restored.length);
        }
        const normalized: LearningSessionRecord = {
          ...saved,
          purpose: savedPurpose,
          phraseIds: restored.map((item) => item.id),
          studyIndex: normalizedStudy,
          testIndex: normalizedTest,
          phase: normalizedPhase,
        };
        if (!sameSessionProgress(saved, normalized)) await repository.saveLearningSession(normalized);
        if (!mountedRef.current || generation !== generationRef.current) return;
        sessionRef.current = normalized;
        if (mountedRef.current) setSessionId(normalized.id);
        replaceQueue(restored);
        replaceStudyIndex(normalizedStudy);
        replaceTestIndex(normalizedTest);
        if (normalizedPhase === "test" && normalizedTest >= restored.length) {
          const completedAt = readNow();
          await repository.completeLearningSession(normalized.id, completedAt);
          if (!mountedRef.current || generation !== generationRef.current) return;
          normalized.completedAt = completedAt.toISOString();
          normalized.updatedAt = completedAt.toISOString();
          replacePhase("complete");
        } else {
          replacePhase(normalizedPhase);
        }
        setOperation(false);
      };

      if (active) {
        await restoreActive(active);
        return;
      }

      if (purpose === "daily" && remaining === 0) {
        replacePhase("goal-complete");
        setOperation(false);
        return;
      }
      const target = purpose === "daily" ? Math.min(5, remaining) : 5;
      const newSessionId = readId();
      const preview = previewLearningGroup(phrases, states, categories.map((item) => item.id), {
        date,
        target,
        reservedPhraseIds: new Set(otherActive?.phraseIds ?? []),
        selectionSeed: newSessionId,
      });
      const { themeCategoryId } = preview;
      if (!themeCategoryId) {
        replacePhase("empty");
        setOperation(false);
        return;
      }
      const selected = preview.phrases;
      if (selected.length === 0) {
        replacePhase("empty");
        setOperation(false);
        return;
      }
      const session: LearningSessionRecord = {
        id: newSessionId,
        purpose,
        date,
        themeCategoryId,
        phraseIds: selected.map((item) => item.id),
        studyIndex: 0,
        testIndex: 0,
        phase: "study",
        startedAt: started.toISOString(),
        updatedAt: started.toISOString(),
      };
      const creation: SessionCreation = {
        repository,
        purpose,
        promise: repository.saveLearningSession(session).then(() => session),
      };
      sessionCreationRef.current = creation;
      void creation.promise.then(
        () => {
          if (sessionCreationRef.current === creation) sessionCreationRef.current = undefined;
        },
        () => {
          if (sessionCreationRef.current === creation) sessionCreationRef.current = undefined;
        },
      );
      try {
        await creation.promise;
      } catch (cause) {
        if (!mountedRef.current || generation !== generationRef.current) return;
        const recovered = await repository.getActiveLearningSession(purpose);
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (recovered) {
          await restoreActive(recovered);
          return;
        }
        throw cause;
      }
      if (!mountedRef.current || generation !== generationRef.current) return;
      sessionRef.current = session;
      if (mountedRef.current) setSessionId(session.id);
      replaceQueue(selected);
      replacePhase("study");
      setOperation(false);
    })().catch(() => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      sessionRef.current = undefined;
      setSessionId(undefined);
      replaceQueue([]);
      replacePhase("error");
      setVisibleError("学习内容暂时无法加载或保存，请重试。");
      setOperation(false);
    });
  }, [dailyGoal, purpose, readId, readNow, replaceDailyRemaining, replacePhase, replaceQueue, replaceRevealed, replaceStudyIndex, replaceTestIndex, repository, setOperation, setVisibleError]);

  useEffect(() => {
    mountedRef.current = true;
    initialize();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      speech.cancel();
    };
  }, [initialize, speech]);

  const current = phase === "study" ? queue[studyIndex] : phase === "test" ? queue[testIndex] : undefined;
  useEffect(() => {
    if (!current || (phase !== "study" && phase !== "test")) return;
    if (phase !== "study") return;
    const generation = generationRef.current;
    const targetRepository = repository;
    void ensureLearningState(current).catch(() => {
      if (generation !== generationRef.current || repositoryRef.current !== targetRepository) return;
      setVisibleError("学习进度保存失败，请重试。");
    });
    if (preferencesRef.current.autoSpeak) {
      void speech.speak(current.english, preferencesRef.current.accent).catch(() => undefined);
    }
  }, [current, ensureLearningState, phase, repository, speech, setVisibleError]);

  const replay = useCallback(async () => {
    const generation = generationRef.current;
    if (phaseRef.current !== "study" && phaseRef.current !== "test") return;
    if (phaseRef.current === "test" && !revealedRef.current) return;
    const item = phaseRef.current === "study"
      ? queueRef.current[studyIndexRef.current]
      : queueRef.current[testIndexRef.current];
    if (!item) return;
    try {
      await speech.speak(item.english, preferencesRef.current.accent);
      if (generation !== generationRef.current) return;
      setVisibleError(undefined);
    } catch {
      if (generation !== generationRef.current) return;
      setVisibleError("发音播放失败，请稍后重试。");
    }
  }, [setVisibleError, speech]);

  const nextStudyPhrase = useCallback(async () => {
    const generation = generationRef.current;
    if (operationRef.current || phaseRef.current !== "study") return;
    const session = sessionRef.current;
    const item = queueRef.current[studyIndexRef.current];
    if (!session || !item) return;
    setOperation(true);
    setVisibleError(undefined);
    try {
      await ensureLearningState(item);
      if (generation !== generationRef.current) return;
      const next = studyIndexRef.current + 1;
      const proposed: LearningSessionRecord = {
        ...session,
        studyIndex: next,
        phase: next >= queueRef.current.length ? "test" : "study",
        testIndex: next >= queueRef.current.length ? 0 : session.testIndex,
        updatedAt: readNow().toISOString(),
      };
      await repository.saveLearningSession(proposed);
      if (generation !== generationRef.current || !mountedRef.current) return;
      sessionRef.current = proposed;
      speech.cancel();
      replaceStudyIndex(next);
      if (proposed.phase === "test") {
        replaceTestIndex(0);
        replaceRevealed(false);
        replacePhase("test");
      }
    } catch {
      if (generation !== generationRef.current) return;
      setVisibleError("学习进度保存失败，请重试。");
    } finally {
      if (generation === generationRef.current) setOperation(false);
    }
  }, [ensureLearningState, readNow, replacePhase, replaceRevealed, replaceStudyIndex, replaceTestIndex, repository, setOperation, setVisibleError, speech]);

  const reveal = useCallback(async () => {
    const generation = generationRef.current;
    if (operationRef.current || phaseRef.current !== "test" || revealedRef.current) return;
    const item = queueRef.current[testIndexRef.current];
    if (!item) return;
    if (generation !== generationRef.current) return;
    replaceRevealed(true);
    if (preferencesRef.current.autoSpeak) {
      void speech.speak(item.english, preferencesRef.current.accent).catch(() => undefined);
    }
  }, [replaceRevealed, speech]);

  const grade = useCallback(async (result: ReviewResult) => {
    const generation = generationRef.current;
    if (operationRef.current || phaseRef.current !== "test" || !revealedRef.current) return;
    const session = sessionRef.current;
    const item = queueRef.current[testIndexRef.current];
    if (!session || !item) return;
    setOperation(true);
    setVisibleError(undefined);
    let reviewSaved = false;
    try {
      if (!pendingReviewRef.current) {
        const occurredAt = readNow().toISOString();
        pendingReviewRef.current = {
          event: {
            id: readId(),
            sessionId: session.id,
            phraseId: item.id,
            source: "new",
            result,
            usedPronunciationHint: false,
            recorded: false,
            activeSeconds: 0,
            occurredAt,
          },
          nextSession: {
            ...session,
            testIndex: testIndexRef.current + 1,
            updatedAt: occurredAt,
          },
        };
      }
      const pending = pendingReviewRef.current;
      await repository.submitFirstLearningReview(pending.event, pending.nextSession);
      if (generation !== generationRef.current) return;
      reviewSaved = true;
      if (pending.nextSession.testIndex >= queueRef.current.length) {
        const completedAt = readNow();
        await repository.completeLearningSession(session.id, completedAt);
        if (generation !== generationRef.current || !mountedRef.current) return;
        sessionRef.current = {
          ...pending.nextSession,
          completedAt: completedAt.toISOString(),
          updatedAt: completedAt.toISOString(),
        };
        replaceTestIndex(pending.nextSession.testIndex);
        replacePhase("complete");
      } else {
        if (generation !== generationRef.current || !mountedRef.current) return;
        sessionRef.current = pending.nextSession;
        replaceTestIndex(pending.nextSession.testIndex);
        replaceRevealed(false);
      }
      pendingReviewRef.current = undefined;
      speech.cancel();
    } catch {
      if (generation !== generationRef.current) return;
      setVisibleError(reviewSaved
        ? "学习会话完成失败，请重试。"
        : "测试结果保存失败，请重试。");
    } finally {
      if (generation === generationRef.current) setOperation(false);
    }
  }, [readId, readNow, replacePhase, replaceRevealed, replaceTestIndex, repository, setOperation, setVisibleError, speech]);

  const examples = phase === "study" && current?.origin === "system" && current.kind === "core"
    ? allPhrases.filter((item) =>
      item.origin === "system" && item.kind === "example" && item.parentPhraseId === current.id
    ).sort((left, right) => (left.unlockOrder ?? Number.MAX_SAFE_INTEGER) - (right.unlockOrder ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id)).slice(0, 2)
    : [];

  return {
    purpose,
    sessionId,
    phase,
    current,
    examples,
    studyIndex,
    testIndex,
    total: queue.length,
    revealed,
    error,
    busy,
    dailyRemaining,
    replay,
    nextStudyPhrase,
    reveal,
    grade,
    retry: initialize,
  };
}
