"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { selectLearningGroup } from "../domain/learningSelection";
import type {
  LearningSessionRecord,
  Phrase,
  PhraseLearningState,
  ReviewResult,
  SpeechPreferences,
  TrainingEvent,
} from "../domain/types";
import type { BrowserSpeechService } from "../services/speech";
import type { PhraseRepository } from "../storage/repository";

export type NewLearningPhase = "loading" | "study" | "test" | "complete" | "empty" | "error";

export interface NewPhraseLearningController {
  phase: NewLearningPhase;
  current?: Phrase;
  examples: Phrase[];
  studyIndex: number;
  testIndex: number;
  total: number;
  revealed: boolean;
  error?: string;
  busy: boolean;
  replay(): Promise<void>;
  nextStudyPhrase(): Promise<void>;
  reveal(): Promise<void>;
  grade(result: ReviewResult): Promise<void>;
  retry(): void;
}

export interface UseNewPhraseLearningOptions {
  repository: PhraseRepository;
  speech: Pick<BrowserSpeechService, "speak" | "cancel">;
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
  promise: Promise<LearningSessionRecord>;
}

const systemNow = () => new Date();
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const defaultPreferences: SpeechPreferences = { accent: "en-US", autoSpeak: true };

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

function dateRotationIndex(date: string, length: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000) % length;
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
  now = systemNow,
  idFactory = createId,
}: UseNewPhraseLearningOptions): NewPhraseLearningController {
  const [phase, setPhase] = useState<NewLearningPhase>("loading");
  const [queue, setQueue] = useState<Phrase[]>([]);
  const [allPhrases, setAllPhrases] = useState<Phrase[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [testIndex, setTestIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(true);

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
    if (existingWrite?.repository === repository) {
      if (existingWrite.generation === generation) return existingWrite.promise;
      return trackWrite(existingWrite.state, existingWrite.promise);
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
    pendingReviewRef.current = undefined;
    setOperation(true);
    setVisibleError(undefined);
    replacePhase("loading");
    replaceQueue([]);
    if (mountedRef.current) setAllPhrases([]);
    replaceStudyIndex(0);
    replaceTestIndex(0);
    replaceRevealed(false);

    void (async () => {
      const [phrases, states, initialActive, categories, preferences] = await Promise.all([
        repository.listPhrases(),
        repository.listPhraseLearningStates(),
        repository.getActiveLearningSession(),
        repository.listCategories(),
        repository.getSpeechPreferences().catch(() => defaultPreferences),
      ]);
      if (!mountedRef.current || generation !== generationRef.current) return;
      setAllPhrases(phrases);
      learningStatesRef.current = new Map(states.map((state) => [state.phraseId, state]));
      preferencesRef.current = preferences;

      let active = initialActive;
      const pendingCreation = sessionCreationRef.current;
      if (!active && pendingCreation?.repository === repository) {
        try {
          active = await pendingCreation.promise;
        } catch {
          if (!mountedRef.current || generation !== generationRef.current) return;
          active = await repository.getActiveLearningSession();
        }
        if (!mountedRef.current || generation !== generationRef.current) return;
      }

      if (active) {
        const byId = new Map(phrases.map((item) => [item.id, item]));
        const restoredWithPositions = active.phraseIds.flatMap((id, position) => {
          const item = byId.get(id);
          return item ? [{ item, position }] : [];
        });
        if (restoredWithPositions.length === 0) {
          throw new Error("学习内容已被删除");
        }
        const restored = restoredWithPositions.map(({ item }) => item);
        const survivingIds = new Set(restored.map((item) => item.id));
        let normalizedStudy = cursorAfterFiltering(active.phraseIds, active.studyIndex, survivingIds);
        let normalizedTest = cursorAfterFiltering(active.phraseIds, active.testIndex, survivingIds);
        let normalizedPhase = active.phase;
        if (normalizedPhase === "study" && normalizedStudy >= restored.length) {
          normalizedStudy = restored.length;
          normalizedTest = 0;
          normalizedPhase = "test";
        } else if (normalizedPhase === "test") {
          normalizedStudy = restored.length;
          normalizedTest = Math.min(normalizedTest, restored.length);
        }
        const normalized: LearningSessionRecord = {
          ...active,
          phraseIds: restored.map((item) => item.id),
          studyIndex: normalizedStudy,
          testIndex: normalizedTest,
          phase: normalizedPhase,
        };
        if (!sameSessionProgress(active, normalized)) await repository.saveLearningSession(normalized);
        if (!mountedRef.current || generation !== generationRef.current) return;
        sessionRef.current = normalized;
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
        return;
      }

      const started = readNow();
      const date = shanghaiDate(started);
      const stateById = new Map(states.map((state) => [state.phraseId, state]));
      const categoryIds = new Set(categories.map((item) => item.id));
      const eligibleSystemThemes = [...new Set(phrases.filter((item) =>
        item.origin === "system"
          && item.kind === "core"
          && !item.retiredAt
          && (stateById.get(item.id)?.stage ?? "unseen") === "unseen"
          && categoryIds.has(item.categoryId)
      ).map((item) => item.categoryId))].sort();
      const eligiblePersonal = phrases.filter((item) =>
        (item.origin ?? "personal") === "personal"
          && (item.kind ?? "standalone") === "standalone"
          && !item.retiredAt
          && (stateById.get(item.id)?.stage ?? "unseen") === "unseen"
          && categoryIds.has(item.categoryId)
      ).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
      const themeCategoryId = eligibleSystemThemes.length > 0
        ? eligibleSystemThemes[dateRotationIndex(date, eligibleSystemThemes.length)]
        : eligiblePersonal[0]?.categoryId;
      if (!themeCategoryId) {
        replacePhase("empty");
        setOperation(false);
        return;
      }
      const selected = selectLearningGroup(phrases, states, { date, themeCategoryId, target: 5 });
      if (selected.length === 0) {
        replacePhase("empty");
        setOperation(false);
        return;
      }
      const session: LearningSessionRecord = {
        id: readId(),
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
        promise: repository.saveLearningSession(session).then(() => session),
      };
      sessionCreationRef.current = creation;
      await creation.promise;
      if (!mountedRef.current || generation !== generationRef.current) return;
      sessionRef.current = session;
      replaceQueue(selected);
      replacePhase("study");
      setOperation(false);
    })().catch(() => {
      if (!mountedRef.current || generation !== generationRef.current) return;
      sessionRef.current = undefined;
      replaceQueue([]);
      replacePhase("error");
      setVisibleError("学习内容暂时无法加载或保存，请重试。");
      setOperation(false);
    });
  }, [readId, readNow, replacePhase, replaceQueue, replaceRevealed, replaceStudyIndex, replaceTestIndex, repository, setOperation, setVisibleError]);

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
    phase,
    current,
    examples,
    studyIndex,
    testIndex,
    total: queue.length,
    revealed,
    error,
    busy,
    replay,
    nextStudyPhrase,
    reveal,
    grade,
    retry: initialize,
  };
}
