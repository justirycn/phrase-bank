"use client";
import { useCallback, useEffect, useRef } from "react";
import { SpeakingPractice } from "../SpeakingPractice";
import type { TrainingMode } from "../../domain/types";
import { useTrainingSession } from "../../hooks/useTrainingSession";
import { TemporaryRecorder } from "../../services/recorder";
import type { PhraseRepository } from "../../storage/repository";
import { screenSpeech } from "./screenSpeech";
const defaultRecorder = new TemporaryRecorder();

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

  useEffect(() => {
    generationRef.current += 1;
    return () => { generationRef.current += 1; };
  }, [completionKey, repository]);

  const complete = useCallback(() => {
    if (completedKeysRef.current.has(completionKey)) return Promise.resolve();
    if (pendingRef.current?.key === completionKey) return pendingRef.current.promise;
    const generation = generationRef.current;
    const promise = (async () => {
      await finish();
      if (generation !== generationRef.current) return;
      await onComplete();
      if (generation === generationRef.current) completedKeysRef.current.add(completionKey);
    })();
    pendingRef.current = { key: completionKey, promise };
    void promise.catch(() => {
      if (generation === generationRef.current) setError("训练进度暂时无法保存，请稍后重试。");
    }).finally(() => {
      if (pendingRef.current?.promise === promise) pendingRef.current = undefined;
    });
    return promise;
  }, [completionKey, finish, onComplete, setError]);

  useEffect(() => {
    if (phase === "complete") void complete();
  }, [complete, phase]);

  const finishAnd = (next: () => void | Promise<void>) => {
    void finish().then(next).catch(() => setError("训练进度暂时无法保存，请稍后重试。"));
  };
  return <SpeakingPractice
    controller={controller}
    onPause={() => void onHome()}
    onHome={() => { if (phase === "complete") void complete(); else if (controller.initializationError) void onHome(); else finishAnd(onHome); }}
    onAgain={() => { if (phase === "complete") void complete(); else if (controller.initializationError) void onAgain(); else finishAnd(onAgain); }}
  />;
}
