"use client";
import { useCallback, useEffect, useRef } from "react";
import { SpeakingPractice } from "../SpeakingPractice";
import type { TrainingMode } from "../../domain/types";
import { useTrainingSession } from "../../hooks/useTrainingSession";
import { TemporaryRecorder } from "../../services/recorder";
import type { PhraseRepository } from "../../storage/repository";
import { screenSpeech } from "./screenSpeech";
const defaultRecorder = new TemporaryRecorder();
const COMPLETION_HANDOFF_TIMEOUT_MS = 10_000;

function withCompletionHandoffFallback(operation: Promise<void>, fallback: () => void | Promise<void>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      void Promise.resolve(fallback()).catch(() => undefined).then(resolve);
    }, COMPLETION_HANDOFF_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

export default function PracticeSession({ repository, mode, newIntroducedToday, completionKey, onComplete, onHome, onAgain, setError }: {
  repository: PhraseRepository; mode: TrainingMode;
  newIntroducedToday: number; completionKey: string; onComplete: (signal: AbortSignal) => Promise<void>;
  onHome: () => Promise<void>; onAgain: () => void | Promise<void>; setError: (message: string) => void;
}) {
  const controller = useTrainingSession({ repository, mode, speech: screenSpeech, recorder: defaultRecorder, newIntroducedToday });
  const { finish, phase } = controller;
  const generationRef = useRef(0);
  const completedKeysRef = useRef(new Set<string>());
  const pendingRef = useRef<{ key: string; promise: Promise<void> }>();
  const handoffControllerRef = useRef<AbortController>();

  useEffect(() => {
    generationRef.current += 1;
    return () => {
      generationRef.current += 1;
      handoffControllerRef.current?.abort();
    };
  }, [completionKey, repository]);

  const complete = useCallback(() => {
    if (completedKeysRef.current.has(completionKey)) return Promise.resolve();
    if (pendingRef.current?.key === completionKey) return pendingRef.current.promise;
    const generation = generationRef.current;
    const controller = new AbortController();
    handoffControllerRef.current = controller;
    const handoff = (async () => {
      await finish();
      if (generation !== generationRef.current || controller.signal.aborted) return;
      await onComplete(controller.signal);
      if (generation === generationRef.current) completedKeysRef.current.add(completionKey);
    })();
    const promise = withCompletionHandoffFallback(handoff, async () => {
      if (generation !== generationRef.current) return;
      controller.abort();
      setError("保存仍在后台进行，已先返回首页，你可以继续使用。");
      await onHome();
    });
    pendingRef.current = { key: completionKey, promise };
    void promise.catch(() => {
      if (generation === generationRef.current) {
        setError("训练进度暂时无法保存，请稍后重试。");
      }
    }).finally(() => {
      if (pendingRef.current?.promise === promise) pendingRef.current = undefined;
      if (handoffControllerRef.current === controller) handoffControllerRef.current = undefined;
    });
    return promise;
  }, [completionKey, finish, onComplete, onHome, setError]);
  const completeRef = useRef(complete);
  useEffect(() => { completeRef.current = complete; }, [complete]);

  useEffect(() => {
    if (phase === "complete") void completeRef.current();
  }, [completionKey, phase]);

  const finishAnd = (next: () => void | Promise<void>) => {
    void finish().then(next).catch(() => setError("训练进度暂时无法保存，请稍后重试。"));
  };
  const leaveCompleted = (next: () => void | Promise<void>) => {
    handoffControllerRef.current?.abort();
    generationRef.current += 1;
    void finish().catch(() => undefined);
    void Promise.resolve(next()).catch(() => setError("暂时无法打开下一步，请重试。"));
  };
  return <SpeakingPractice
    controller={controller}
    onPause={() => void onHome()}
    onHome={() => { if (phase === "complete") leaveCompleted(onHome); else if (controller.initializationError) void onHome(); else finishAnd(onHome); }}
    onAgain={() => { if (phase === "complete") leaveCompleted(onAgain); else if (controller.initializationError) void onAgain(); else finishAnd(onAgain); }}
  />;
}
