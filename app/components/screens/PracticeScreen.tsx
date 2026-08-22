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
type CompletionIntent = { key: "home" | "again"; run: () => void | Promise<void> };

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
  newIntroducedToday: number; completionKey: string; onComplete: () => Promise<void>;
  onHome: () => Promise<void>; onAgain: () => void | Promise<void>; setError: (message: string) => void;
}) {
  const controller = useTrainingSession({ repository, mode, speech: screenSpeech, recorder: defaultRecorder, newIntroducedToday });
  const { finish, phase } = controller;
  const generationRef = useRef(0);
  const completedKeysRef = useRef(new Set<string>());
  const pendingRef = useRef<{ key: string; promise: Promise<void> }>();
  const intentRef = useRef<CompletionIntent>();

  useEffect(() => {
    generationRef.current += 1;
    return () => { generationRef.current += 1; };
  }, [completionKey, repository]);

  const complete = useCallback((intent?: CompletionIntent) => {
    if (intent) intentRef.current = intent;
    if (completedKeysRef.current.has(completionKey)) {
      const selected = intentRef.current;
      intentRef.current = undefined;
      return Promise.resolve(selected?.run()).then(() => undefined);
    }
    if (pendingRef.current?.key === completionKey) return pendingRef.current.promise;
    const generation = generationRef.current;
    const handoff = (async () => {
      await finish();
      if (generation !== generationRef.current) return;
      const selected = intentRef.current;
      intentRef.current = undefined;
      if (selected) await selected.run();
      else await onComplete();
      if (generation === generationRef.current) completedKeysRef.current.add(completionKey);
    })();
    const promise = withCompletionHandoffFallback(handoff, async () => {
      if (generation !== generationRef.current) return;
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
  return <SpeakingPractice
    controller={controller}
    onPause={() => void onHome()}
    onHome={() => { if (phase === "complete" || controller.initializationError) void onHome(); else finishAnd(onHome); }}
    onAgain={() => { if (phase === "complete") void complete({ key: "again", run: onAgain }); else if (controller.initializationError) void onAgain(); else finishAnd(onAgain); }}
  />;
}
