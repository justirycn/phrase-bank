"use client";
import { NewPhraseLearning } from "../NewPhraseLearning";
import { useNewPhraseLearning } from "../../hooks/useNewPhraseLearning";
import type { PhraseRepository } from "../../storage/repository";
import { screenSpeech } from "./screenSpeech";

export default function LearningSession({ repository, onHome }: { repository: PhraseRepository; onHome: () => void }) {
  const speech = screenSpeech;
  const controller = useNewPhraseLearning({ repository, speech });
  return <NewPhraseLearning controller={controller} onHome={onHome} />;
}
