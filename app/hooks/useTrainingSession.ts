"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewResult, TrainingEvent, TrainingMode, TrainingSessionRecord, TrainingSource } from "../domain/types";
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
  usedHint: boolean;
  recordingUrl?: string;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  revealAsUnknown(): Promise<void>;
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
const trainingSources = new Set<TrainingSource>(["due", "weak", "mature", "new", "requeue"]);

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
  const [usedHint, setUsedHint] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string>();
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
  const sessionWriteRef = useRef<Promise<void>>(Promise.resolve());
  const finishingRef = useRef(false);
  const finishPromiseRef = useRef<Promise<void>>();

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
    const timestamp = now().toISOString();
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
  }, [now, repository]);

  const persistProposedIndex = useCallback(async (proposedIndex: number): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    const snapshot: TrainingSessionRecord = {
      ...session,
      phraseIds: queueRef.current.map((candidate) => candidate.phrase.id),
      sources: queueRef.current.map((candidate) => candidate.source),
      currentIndex: proposedIndex,
      updatedAt: now().toISOString(),
    };
    const write = sessionWriteRef.current
      .catch(() => undefined)
      .then(() => repository.saveTrainingSession(snapshot));
    sessionWriteRef.current = write;
    await write;
    Object.assign(session, snapshot);
  }, [now, repository]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    void (async () => {
      const [active, phrases, events] = await Promise.all([
        repository.getActiveTrainingSession(),
        repository.listPhrases(),
        repository.listTrainingEvents(),
      ]);
      if (cancelled) return;
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
            .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
          if (phraseEvents.length > priorOccurrences) {
            const evaluation = phraseEvents[priorOccurrences];
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

      const started = now();
      const selected = selectTrainingGroup(phrases, {
        mode,
        now: started,
        seed: seed ?? started.toISOString().slice(0, 10),
        newIntroducedToday,
      });
      const session: TrainingSessionRecord = {
        id: globalThis.crypto.randomUUID(),
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
      replaceQueue(selected);
      replaceIndex(0);
      if (selected.length === 0) setPhase("complete");
      await persistSession();
    })();
    return () => { cancelled = true; };
  }, [mode, newIntroducedToday, now, persistSession, repository, replaceIndex, replaceQueue, seed]);

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
      const preferences = await repository.getSpeechPreferences();
      await speech.speak(current.phrase.english, preferences.accent);
    } catch {
      // Pronunciation is an enhancement; unsupported browsers must not block practice.
    }
  }, [repository, speech]);

  const autoSpeakCurrent = useCallback(async () => {
    try {
      const preferences = await repository.getSpeechPreferences();
      if (!preferences.autoSpeak) return;
      const current = queueRef.current[indexRef.current];
      if (current) await speech.speak(current.phrase.english, preferences.accent);
    } catch {
      // Keep the answer and grading controls usable after a speech failure.
    }
  }, [repository, speech]);

  const recordEvent = useCallback(async (result: ReviewResult) => {
    const session = sessionRef.current;
    const current = queueRef.current[indexRef.current];
    if (!session || !current) return;
    if (!pendingEventRef.current) {
      const occurredAt = now();
      const activeSecondsSnapshot = session.activeSeconds;
      pendingEventRef.current = {
        activeSecondsSnapshot,
        event: {
          id: globalThis.crypto.randomUUID(),
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
  }, [now, repository]);

  const resetItemState = useCallback(() => {
    setUsedHint(false);
    usedHintRef.current = false;
    recordedRef.current = false;
    evaluatedRef.current = false;
    pendingEventRef.current = undefined;
    setRecordingUrl(undefined);
    setPhase("prompt");
  }, []);

  const advance = useCallback(async () => {
    const next = indexRef.current + 1;
    await persistProposedIndex(next);
    replaceIndex(next);
    resetItemState();
    if (next >= queueRef.current.length) setPhase("complete");
  }, [persistProposedIndex, replaceIndex, resetItemState]);

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
    if (operationRef.current || phase !== "recording") return;
    operationRef.current = true;
    try {
      const recording = await recorder.stop();
      if (!mountedRef.current) return;
      recordedRef.current = true;
      setRecordingUrl(recording.url);
      setPhase("answer");
      await autoSpeakCurrent();
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
      await recordEvent("again");
      evaluatedRef.current = true;
      const laterQueue = queueRef.current.slice(indexRef.current + 1);
      if (!laterQueue.some((candidate) => candidate.phrase.id === current.phrase.id)) {
        replaceQueue([...queueRef.current, { ...current, source: "requeue" }]);
      }
      setPhase("answer");
      await persistSession();
      await autoSpeakCurrent();
    } finally {
      operationRef.current = false;
    }
  }, [autoSpeakCurrent, persistSession, phase, recordEvent, replaceQueue]);

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
        await recordEvent(result);
        evaluatedRef.current = true;
      }
      await advance();
      return { accepted: true };
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
        const finishedAt = now();
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
  }, [now, persistSession, recorder, repository, speech]);

  return {
    phase,
    current: queue[index],
    index,
    total: queue.length,
    usedHint,
    recordingUrl,
    startRecording,
    stopRecording,
    revealAsUnknown,
    usePronunciationHint,
    repeatPronunciation: speakCurrent,
    grade,
    finish,
  };
}
