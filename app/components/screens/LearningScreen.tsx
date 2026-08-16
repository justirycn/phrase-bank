"use client";
import { useEffect, useRef } from "react";
import { NewPhraseLearning } from "../NewPhraseLearning";
import { useNewPhraseLearning } from "../../hooks/useNewPhraseLearning";
import type { LearningSessionPurpose } from "../../domain/types";
import type { PhraseRepository } from "../../storage/repository";
import { screenSpeech } from "./screenSpeech";

export default function LearningSession({
  repository,
  purpose = "autonomous",
  dailyGoal,
  onHome,
  onStartAutonomous,
  onDailyGoalComplete,
}: {
  repository: PhraseRepository;
  purpose?: LearningSessionPurpose;
  dailyGoal?: number;
  onHome: () => void;
  onStartAutonomous?: () => void;
  onDailyGoalComplete?: () => Promise<void> | void;
}) {
  const speech = screenSpeech;
  const controller = useNewPhraseLearning({ repository, speech, purpose, dailyGoal });
  const { phase, retry, sessionId } = controller;
  const continuedSessionsRef = useRef(new Set<string>());
  const goalNotifiedRef = useRef(false);

  useEffect(() => {
    if (purpose !== "daily" || phase !== "complete" || !sessionId
      || continuedSessionsRef.current.has(sessionId)) return;
    continuedSessionsRef.current.add(sessionId);
    retry();
  }, [phase, purpose, retry, sessionId]);

  useEffect(() => {
    if (purpose !== "daily" || phase !== "goal-complete" || goalNotifiedRef.current) return;
    goalNotifiedRef.current = true;
    void Promise.resolve(onDailyGoalComplete?.()).catch(() => undefined);
  }, [onDailyGoalComplete, phase, purpose]);

  return <NewPhraseLearning
    controller={controller}
    onHome={onHome}
    onStartAutonomous={onStartAutonomous}
  />;
}
