"use client";
import { NewPhraseLearning } from "../NewPhraseLearning";
import { DAILY_NEW_PHRASE_LIMIT } from "../../domain/learningSelection";
import { useNewPhraseLearning } from "../../hooks/useNewPhraseLearning";
import { BrowserSpeechService } from "../../services/speech";
import type { PhraseRepository } from "../../storage/repository";
const defaultSpeech = new BrowserSpeechService();

export default function LearningSession({ repository, onHome }: { repository: PhraseRepository; onHome: () => void }) {
  const speech = defaultSpeech;
  const controller = useNewPhraseLearning({ repository, speech, dailyLimit: DAILY_NEW_PHRASE_LIMIT });
  return <NewPhraseLearning controller={controller} onHome={onHome} />;
}
