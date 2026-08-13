"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewResult, SpeechPreferences, TrainingEvent, TrainingMode, TrainingSessionRecord, TrainingSource } from "../domain/types";
import { selectTrainingGroup, type TrainingCandidate } from "../domain/trainingSelection";
import type { PhraseRepository } from "../storage/repository";
import type { BrowserSpeechService } from "../services/speech";
import type { TemporaryRecorder } from "../services/recorder";

export type TrainingPhase = "prompt" | "recording" | "answer" | "complete";

export interface TrainingSessionController {
  phase: TrainingPhase;
  current?: TrainingCandidate;
  index: number;
  total: number;
  activeSeconds: number;
  usedHint: boolean;
  recordingUrl?: string;
  initializationError?: string;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  revealAsUnknown(): Promise<void>;
  revealForSelfAssessment(): Promise<void>;
  usePronunciationHint(): Promise<void>;
  repeatPronunciation(): Promise<void>;
  grade(result: ReviewResult): Promise<{ accepted: boolean }>;
  finish(): Promise<void>;
}

export interface UseTrainingSessionOptions {
  repository: PhraseRepository;
  mode: TrainingMode;
  speech: Pick<BrowserSpeechService, "speak" | "cancel">;
  recorder: Pick<TemporaryRecorder, "start" | "stop" | "dispose">;
  seed?: string;
  now?: () => Date;
  newIntroducedToday?: number;
}

const IDLE_LIMIT_MS = 60_000;
const CHECKPOINT_SECONDS = 30;
const systemNow = () => new Date();
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const trainingSources = new Set<TrainingSource>(["due", "weak", "mature", "new", "requeue"]);
const shanghaiDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const shanghaiDay = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : shanghaiDayFormatter.format(date);
};
const compareTimestampAndId = (
  leftTimestamp: string,
  leftId: string,
  rightTimestamp: string,
  rightId: string,
) => new Date(leftTimestamp).getTime() - new Date(rightTimestamp).getTime()
  || leftId.localeCompare(rightId);
const queueAfterReview = (
  queue: TrainingCandidate[],
  index: number,
  result: ReviewResult,
): TrainingCandidate[] => {
  const current = queue[index];
  if (result !== "again" || !current) return queue;
  const requeueCount = queue.filter((candidate) => (
    candidate.source === "requeue" && candidate.phrase.id === current.phrase.id
  )).length;
  if (requeueCount >= 3) return queue;
  const nextQueue = [...queue];
  const insertionIndex = Math.min(index + 3, nextQueue.length);
  nextQueue.splice(insertionIndex, 0, { ...current, source: "requeue" });
  return nextQueue;
};

export function useTrainingSession({
  repository,
  mode,
  speech,
  recorder,
  seed,
  now = systemNow,
  newIntroducedToday = 0,
}: UseTrainingSessionOptions): TrainingSessionController {
  const [phase, setPhase] = useState<TrainingPhase>("prompt");
  const [queue, setQueue] = useState<TrainingCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [usedHint, setUsedHint] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string>();
  const [initializationError, setInitializationError] = useState<string>();
  const sessionRef = useRef<TrainingSessionRecord>();
  const queueRef = useRef<TrainingCandidate[]>([]);
  const indexRef = useRef(0);
  const usedHintRef = useRef(false);
  const recordedRef = useRef(false);
  const evaluatedRef = useRef(false);
  const operationRef = useRef(false);
  const mountedRef = useRef(true);
  const lastInteractionRef = useRef(0);
  const lastTickRef = useRef(0);
  const checkpointRef = useRef(0);
  const eventActiveBaseRef = useRef(0);
  const pendingEventRef = useRef<{ event: TrainingEvent; activeSecondsSnapshot: number }>();
  const pendingQueueRef = useRef<TrainingCandidate[]>();
  const sessionWriteRef = useRef<Promise<void>>(Promise.resolve());
  const finishingRef = useRef(false);
  const finishPromiseRef = useRef<Promise<void>>();
  const speechPreferencesRef = useRef<SpeechPreferences>({ accent: "en-US", autoSpeak: true });
  const nowRef = useRef(now);
  const readNow = useCallback(() => nowRef.current(), []);

  useEffect(() => {
    nowRef.current = now;
  }, [now]);

  const replaceQueue = useCallback((next: TrainingCandidate[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const replaceIndex = useCallback((next: number) => {
    indexRef.current = next;
    setIndex(next);
  }, []);

  const persistSession = useCallback((whileFinishing = false): Promise<void> => {
    if (finishingRef.current && !whileFinishing) return Promise.resolve();
    const session = sessionRef.current;
    if (!session) return Promise.resolve();
    const timestamp = readNow().toISOString();
    session.phraseIds = queueRef.current.map((candidate) => candidate.phrase.id);
    session.sources = queueRef.current.map((candidate) => candidate.source);
    session.currentIndex = indexRef.current;
    session.updatedAt = timestamp;
    const snapshot: TrainingSessionRecord = {
      ...session,
      phraseIds: [...session.phraseIds],
      sources: session.sources ? [...session.sources] : undefined,
    };
    const write = sessionWriteRef.current
      .catch(() => undefined)
      .then(() => repository.saveTrainingSession(snapshot));
    sessionWriteRef.current = write;
    return write;
  }, [readNow, repository]);

  const persistProposedState = useCallback(async (
    proposedQueue: TrainingCandidate[],
    proposedIndex: number,
  ): Promise<boolean> => {
    if (finishingRef.current) return false;
    const session = sessionRef.current;
    if (!session) return false;
    const snapshot: TrainingSessionRecord = {
      ...session,
      phraseIds: proposedQueue.map((candidate) => candidate.phrase.id),
      sources: proposedQueue.map((candidate) => candidate.source),
      currentIndex: proposedIndex,
      updatedAt: readNow().toISOString(),
    };
    const write = sessionWriteRef.current
      .catch(() => undefined)
      .then(() => repository.saveTrainingSession(snapshot));
    sessionWriteRef.current = write;
    await write;
    if (finishingRef.current) return false;
    Object.assign(session, snapshot);
    return true;
  }, [readNow, repository]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      const [active, phrases, events, learningStates, speechPreferences, snapshot] = await Promise.all([
        repository.getActiveTrainingSession(),
        repository.listPhrases(),
        repository.listTrainingEvents(),
        repository.listPhraseLearningStates(),
        repository.getSpeechPreferences().catch(() => ({ accent: "en-US", autoSpeak: true } as const)),
        repository.exportSnapshot(),
      ]);
      if (cancelled) return;
      speechPreferencesRef.current = speechPreferences;
      if (active) {
        const byId = new Map(phrases.map((item) => [item.id, item]));
        const seen = new Set<string>();
        const hasAlignedSources = active.sources?.length === active.phraseIds.length
          && active.sources.every((source) => trainingSources.has(source));
        const restoredWithPositions = active.phraseIds.flatMap((id, position) => {
          const item = byId.get(id);
          if (!item) return [];
          const source = hasAlignedSources
            ? active.sources![position]
            : seen.has(id) ? "requeue" as const : "due" as const;
          seen.add(id);
          return [{ candidate: { phrase: item, source }, position }];
        });
        const restored = restoredWithPositions.map((item) => item.candidate);
        const originalIndex = Math.min(active.currentIndex, active.phraseIds.length);
        const normalizedIndex = restoredWithPositions.filter((item) => item.position < originalIndex).length;
        sessionRef.current = {
          ...active,
          phraseIds: restored.map((item) => item.phrase.id),
          sources: restored.map((item) => item.source),
        };
        checkpointRef.current = active.activeSeconds;
        setActiveSeconds(active.activeSeconds);
        eventActiveBaseRef.current = events
          .filter((event) => event.sessionId === active.id)
          .reduce((sum, event) => sum + event.activeSeconds, 0);
        replaceQueue(restored);
        replaceIndex(normalizedIndex);
        if (normalizedIndex >= restored.length) {
          setPhase("complete");
        } else {
          const currentPhraseId = restored[normalizedIndex]?.phrase.id;
          const priorOccurrences = active.phraseIds
            .slice(0, originalIndex)
            .filter((id) => id === currentPhraseId).length;
          const phraseEvents = events
            .filter((event) => event.sessionId === active.id && event.phraseId === currentPhraseId)
            .sort((left, right) => compareTimestampAndId(
              left.occurredAt,
              left.id,
              right.occurredAt,
              right.id,
            ));
          if (phraseEvents.length > priorOccurrences) {
            const evaluation = phraseEvents[priorOccurrences];
            const expectedRequeues = Math.min(3, phraseEvents
              .slice(0, priorOccurrences + 1)
              .filter((event) => event.result === "again").length);
            const persistedRequeues = restored.filter((candidate) => (
              candidate.source === "requeue" && candidate.phrase.id === currentPhraseId
            )).length;
            const recovered = persistedRequeues < expectedRequeues
              ? queueAfterReview(restored, normalizedIndex, evaluation.result)
              : restored;
            pendingQueueRef.current = recovered;
            if (recovered !== restored) replaceQueue(recovered);
            evaluatedRef.current = true;
            usedHintRef.current = evaluation.usedPronunciationHint;
            recordedRef.current = evaluation.recorded;
            setUsedHint(evaluation.usedPronunciationHint);
            setPhase("answer");
          }
        }
        await persistSession();
        return;
      }

      const started = readNow();
      const startedDay = shanghaiDay(started);
      const todayEvents = events.filter((event) => shanghaiDay(event.occurredAt) === startedDay);
      const latestTodayEventByPhrase = new Map<string, TrainingEvent>();
      for (const event of todayEvents) {
        const latest = latestTodayEventByPhrase.get(event.phraseId);
        if (!latest || compareTimestampAndId(
          event.occurredAt,
          event.id,
          latest.occurredAt,
          latest.id,
        ) > 0) {
          latestTodayEventByPhrase.set(event.phraseId, event);
        }
      }
      const goodTodayIds = new Set([...latestTodayEventByPhrase.values()]
        .filter((event) => event.result === "good")
        .map((event) => event.phraseId));
      const completedToday = snapshot.trainingSessions
        .filter((session) => Boolean(session.completedAt) && shanghaiDay(session.completedAt!) === startedDay)
        .sort((left, right) => compareTimestampAndId(
          left.completedAt!,
          left.id,
          right.completedAt!,
          right.id,
        ));
      const practicedTodayIds = new Set([
        ...todayEvents.map((event) => event.phraseId),
        ...completedToday.flatMap((session) => session.phraseIds),
      ]);
      const previousGroupIds = new Set(completedToday.at(-1)?.phraseIds ?? []);
      const phrasesById = new Map(phrases.map((phrase) => [phrase.id, phrase]));
      const persistedNewCount = new Set(todayEvents.filter((event) => event.source === "new")
        .map((event) => event.phraseId)).size;
      const personalNewCount = new Set(todayEvents.filter((event) => event.source === "new" && (phrasesById.get(event.phraseId)?.origin ?? "personal") === "personal").map((event) => event.phraseId)).size;
      const systemNewCount = new Set(todayEvents.filter((event) => event.source === "new" && phrasesById.get(event.phraseId)?.origin === "system").map((event) => event.phraseId)).size;
      const practicedPersonal = new Set(todayEvents.filter((event) => (phrasesById.get(event.phraseId)?.origin ?? "personal") === "personal").map((event) => event.phraseId));
      const practicedSystemNew = new Set(todayEvents.filter((event) => phrasesById.get(event.phraseId)?.origin === "system" && event.source === "new").map((event) => event.phraseId));
      const practicedDue = new Set(todayEvents.filter((event) => phrasesById.get(event.phraseId)?.origin === "system" && event.source !== "new").map((event) => event.phraseId));
      const selected = selectTrainingGroup(phrases, {
        mode,
        now: started,
        seed: seed ?? started.toISOString().slice(0, 10),
        newIntroducedToday: Math.max(newIntroducedToday, persistedNewCount),
        personalNewIntroducedToday: personalNewCount,
        systemNewIntroducedToday: Math.max(newIntroducedToday, systemNewCount),
        learningStates,
        practicedTodayIds,
        goodTodayIds,
        previousGroupIds,
        rotationCursor: completedToday.length,
        practicedTodayBucketCounts: { personal: practicedPersonal.size, due: practicedDue.size, systemNew: practicedSystemNew.size },
      });
      const session: TrainingSessionRecord = {
        id: createId(),
        mode,
        startedAt: started.toISOString(),
        updatedAt: started.toISOString(),
        phraseIds: selected.map((item) => item.phrase.id),
        sources: selected.map((item) => item.source),
        currentIndex: 0,
        activeSeconds: 0,
      };
      sessionRef.current = session;
      eventActiveBaseRef.current = 0;
      setActiveSeconds(0);
      replaceQueue(selected);
      replaceIndex(0);
      if (selected.length === 0) setPhase("complete");
      await persistSession();
    })().catch(() => {
      if (cancelled || !mountedRef.current) return;
      sessionRef.current = undefined;
      replaceQueue([]);
      replaceIndex(0);
      setPhase("prompt");
      setInitializationError("训练内容暂时无法加载，请检查本地数据后重试。");
    });
    return () => { cancelled = true; };
  }, [mode, newIntroducedToday, persistSession, readNow, repository, replaceIndex, replaceQueue, seed]);

  useEffect(() => {
    lastInteractionRef.current = Date.now();
    lastTickRef.current = Date.now();
    const markInteraction = () => { lastInteractionRef.current = Date.now(); };
    window.addEventListener("pointerdown", markInteraction);
    window.addEventListener("keydown", markInteraction);
    const timer = window.setInterval(() => {
      const tick = Date.now();
      const delta = Math.max(0, tick - lastTickRef.current);
      lastTickRef.current = tick;
      const session = sessionRef.current;
      if (
        !session
        || finishingRef.current
        || operationRef.current
        || phase === "complete"
        || document.visibilityState !== "visible"
        || tick - lastInteractionRef.current > IDLE_LIMIT_MS
      ) return;
      session.activeSeconds += delta / 1000;
      setActiveSeconds(session.activeSeconds);
      if (session.activeSeconds - checkpointRef.current >= CHECKPOINT_SECONDS) {
        checkpointRef.current = session.activeSeconds;
        void persistSession().catch(() => {
          checkpointRef.current = Math.max(0, checkpointRef.current - CHECKPOINT_SECONDS);
        });
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
    };
  }, [persistSession, phase]);

  useEffect(() => () => {
    mountedRef.current = false;
    speech.cancel();
    recorder.dispose();
  }, [recorder, speech]);

  const speakCurrent = useCallback(async () => {
    const current = queueRef.current[indexRef.current];
    if (!current) return;
    try {
      await speech.speak(current.phrase.english, speechPreferencesRef.current.accent);
    } catch {
      // Pronunciation is an enhancement; unsupported browsers must not block practice.
    }
  }, [speech]);

  const autoSpeakCurrent = useCallback(() => {
    const preferences = speechPreferencesRef.current;
    if (!preferences.autoSpeak) return;
    const current = queueRef.current[indexRef.current];
    if (current) void speech.speak(current.phrase.english, preferences.accent).catch(() => {
      // Keep the answer and grading controls usable after a speech failure.
    });
  }, [speech]);

  const recordEvent = useCallback(async (result: ReviewResult): Promise<TrainingEvent | undefined> => {
    const session = sessionRef.current;
    const current = queueRef.current[indexRef.current];
    if (!session || !current) return;
    if (!pendingEventRef.current) {
      const occurredAt = readNow();
      const activeSecondsSnapshot = session.activeSeconds;
      pendingEventRef.current = {
        activeSecondsSnapshot,
        event: {
          id: createId(),
          sessionId: session.id,
          phraseId: current.phrase.id,
          source: current.source,
          result,
          usedPronunciationHint: usedHintRef.current,
          recorded: recordedRef.current,
          activeSeconds: Math.max(0, activeSecondsSnapshot - eventActiveBaseRef.current),
          occurredAt: occurredAt.toISOString(),
        },
      };
    }
    const pending = pendingEventRef.current;
    await repository.submitTrainingReview(pending.event);
    eventActiveBaseRef.current = pending.activeSecondsSnapshot;
    return pending.event;
  }, [readNow, repository]);

  const resetItemState = useCallback(() => {
    setUsedHint(false);
    usedHintRef.current = false;
    recordedRef.current = false;
    evaluatedRef.current = false;
    pendingEventRef.current = undefined;
    pendingQueueRef.current = undefined;
    setRecordingUrl(undefined);
    setPhase("prompt");
  }, []);

  const advance = useCallback(async (): Promise<boolean> => {
    const next = indexRef.current + 1;
    const nextQueue = pendingQueueRef.current ?? queueRef.current;
    if (!await persistProposedState(nextQueue, next) || finishingRef.current) return false;
    speech.cancel();
    if (nextQueue !== queueRef.current) replaceQueue(nextQueue);
    replaceIndex(next);
    resetItemState();
    if (next >= queueRef.current.length) setPhase("complete");
    return true;
  }, [persistProposedState, replaceIndex, replaceQueue, resetItemState, speech]);

  const startRecording = useCallback(async () => {
    if (operationRef.current || phase !== "prompt") return;
    operationRef.current = true;
    try {
      await recorder.start();
      if (mountedRef.current) setPhase("recording");
    } finally {
      operationRef.current = false;
    }
  }, [phase, recorder]);

  const stopRecording = useCallback(async () => {
    // A press can be released before React commits the recording phase. The
    // component awaits startRecording first, so accepting the prompt closure
    // here safely completes that same recording.
    if (operationRef.current || (phase !== "recording" && phase !== "prompt")) return;
    operationRef.current = true;
    try {
      const recording = await recorder.stop();
      if (!mountedRef.current) return;
      recordedRef.current = true;
      setRecordingUrl(recording.url);
      setPhase("answer");
      void autoSpeakCurrent();
    } finally {
      operationRef.current = false;
    }
  }, [autoSpeakCurrent, phase, recorder]);

  const revealAsUnknown = useCallback(async () => {
    if (operationRef.current || evaluatedRef.current || phase === "complete") return;
    operationRef.current = true;
    try {
      const current = queueRef.current[indexRef.current];
      if (!current) return;
      const evaluation = await recordEvent("again");
      if (!evaluation || finishingRef.current) return;
      const nextQueue = queueAfterReview(queueRef.current, indexRef.current, evaluation.result);
      pendingQueueRef.current = nextQueue;
      if (!await persistProposedState(nextQueue, indexRef.current) || finishingRef.current) return;
      if (nextQueue !== queueRef.current) replaceQueue(nextQueue);
      evaluatedRef.current = true;
      setPhase("answer");
      void autoSpeakCurrent();
    } finally {
      operationRef.current = false;
    }
  }, [autoSpeakCurrent, persistProposedState, phase, recordEvent, replaceQueue]);

  const revealForSelfAssessment = useCallback(async () => {
    if (operationRef.current || phase !== "prompt") return;
    setPhase("answer");
    void autoSpeakCurrent();
  }, [autoSpeakCurrent, phase]);

  const usePronunciationHint = useCallback(async () => {
    if (phase !== "prompt") return;
    usedHintRef.current = true;
    setUsedHint(true);
    await speakCurrent();
  }, [phase, speakCurrent]);

  const grade = useCallback(async (result: ReviewResult) => {
    if (operationRef.current || phase === "complete") return { accepted: false };
    if (result === "good" && usedHintRef.current) return { accepted: false };
    operationRef.current = true;
    try {
      if (!evaluatedRef.current) {
        const evaluation = await recordEvent(result);
        if (!evaluation) return { accepted: false };
        evaluatedRef.current = true;
        pendingQueueRef.current = queueAfterReview(queueRef.current, indexRef.current, evaluation.result);
      }
      return { accepted: await advance() };
    } finally {
      operationRef.current = false;
    }
  }, [advance, phase, recordEvent]);

  const finish = useCallback(async () => {
    if (finishPromiseRef.current) return finishPromiseRef.current;
    const session = sessionRef.current;
    finishingRef.current = true;
    if (mountedRef.current) setPhase("complete");
    speech.cancel();
    recorder.dispose();
    const completion = (async () => {
      if (session && !session.completedAt) {
        const finishedAt = readNow();
        await persistSession(true);
        await repository.completeTrainingSession(session.id, finishedAt);
        session.completedAt = finishedAt.toISOString();
      }
    })();
    finishPromiseRef.current = completion;
    try {
      await completion;
    } catch (error) {
      finishingRef.current = false;
      finishPromiseRef.current = undefined;
      throw error;
    }
  }, [persistSession, readNow, recorder, repository, speech]);

  return {
    phase,
    current: queue[index],
    index,
    total: queue.length,
    activeSeconds,
    usedHint,
    recordingUrl,
    initializationError,
    startRecording,
    stopRecording,
    revealAsUnknown,
    revealForSelfAssessment,
    usePronunciationHint,
    repeatPronunciation: speakCurrent,
    grade,
    finish,
  };
}
