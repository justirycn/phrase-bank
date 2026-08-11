"use client";
import { useEffect } from "react";
import { SpeakingPractice } from "../SpeakingPractice";
import type { TrainingMode } from "../../domain/types";
import { useTrainingSession } from "../../hooks/useTrainingSession";
import { TemporaryRecorder } from "../../services/recorder";
import type { PhraseRepository } from "../../storage/repository";
import { screenSpeech } from "./screenSpeech";
const defaultRecorder = new TemporaryRecorder();

export default function PracticeSession({ repository, mode, newIntroducedToday, onHome, onAgain, setError }: {
  repository: PhraseRepository; mode: TrainingMode;
  newIntroducedToday: number; onHome: () => Promise<void>; onAgain: () => void | Promise<void>; setError: (message: string) => void;
}) {
  const controller = useTrainingSession({ repository, mode, speech: screenSpeech, recorder: defaultRecorder, newIntroducedToday });
  const { finish, phase } = controller;
  useEffect(() => {
    if (phase === "complete") void finish().catch(() => setError("训练进度暂时无法保存，请稍后重试。"));
  }, [finish, phase, setError]);
  return <SpeakingPractice controller={controller} onHome={() => void controller.finish().then(onHome).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} onAgain={() => void controller.finish().then(onAgain).catch(() => setError("训练进度暂时无法保存，请稍后重试。"))} />;
}
