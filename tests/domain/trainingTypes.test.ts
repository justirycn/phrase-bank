import { describe, expect, it } from "vitest";
import type {
  BackupEnvelope,
  DailyTrainingSummary,
  LearningPhase,
  LearningSessionRecord,
  LearningStage,
  PhraseLearningState,
  SpeechPreferences,
  TrainingEvent,
  TrainingSessionRecord,
} from "../../app/domain/types";

describe("speaking practice domain types", () => {
  it("retains every training field value", () => {
    const event = {
      id: "event-1",
      sessionId: "session-1",
      phraseId: "phrase-1",
      source: "requeue",
      result: "good",
      usedPronunciationHint: true,
      recorded: false,
      activeSeconds: 42,
      occurredAt: "2026-08-07T08:00:00.000Z",
    } satisfies TrainingEvent;
    const session = {
      id: "session-1",
      mode: "standard",
      startedAt: "2026-08-07T08:00:00.000Z",
      updatedAt: "2026-08-07T08:05:00.000Z",
      completedAt: "2026-08-07T08:05:00.000Z",
      phraseIds: ["phrase-1"],
      currentIndex: 1,
      activeSeconds: 42,
    } satisfies TrainingSessionRecord;
    const preferences = { accent: "en-GB", autoSpeak: true } satisfies SpeechPreferences;
    const summary = {
      date: "2026-08-07",
      activeSeconds: 42,
      completedGroups: 1,
      spokenCount: 1,
      masteredCount: 1,
      promotedCount: 1,
      lightDayUsed: false,
    } satisfies DailyTrainingSummary;

    expect({ event, session, preferences, summary }).toEqual({
      event: {
        id: "event-1", sessionId: "session-1", phraseId: "phrase-1", source: "requeue", result: "good",
        usedPronunciationHint: true, recorded: false, activeSeconds: 42, occurredAt: "2026-08-07T08:00:00.000Z",
      },
      session: {
        id: "session-1", mode: "standard", startedAt: "2026-08-07T08:00:00.000Z", updatedAt: "2026-08-07T08:05:00.000Z",
        completedAt: "2026-08-07T08:05:00.000Z", phraseIds: ["phrase-1"], currentIndex: 1, activeSeconds: 42,
      },
      preferences: { accent: "en-GB", autoSpeak: true },
      summary: {
        date: "2026-08-07", activeSeconds: 42, completedGroups: 1, spokenCount: 1, masteredCount: 1,
        promotedCount: 1, lightDayUsed: false,
      },
    });
  });

  it("retains every guided learning lifecycle value", () => {
    const stages = ["unseen", "learning", "learned", "mastered"] satisfies LearningStage[];
    const phases = ["study", "test"] satisfies LearningPhase[];
    const learningState = {
      phraseId: "phrase-1",
      stage: "learning",
      firstSeenAt: "2026-08-10T08:00:00.000Z",
      firstTestedAt: "2026-08-10T08:03:00.000Z",
      firstResult: "good",
      consecutiveGood: 1,
      masteredDates: ["2026-08-10"],
      unlockedAt: "2026-08-10T07:59:00.000Z",
      updatedAt: "2026-08-10T08:03:00.000Z",
    } satisfies PhraseLearningState;
    const learningSession = {
      id: "learning-session-1",
      date: "2026-08-10",
      themeCategoryId: "travel",
      phraseIds: ["phrase-1"],
      studyIndex: 1,
      testIndex: 0,
      phase: "test",
      startedAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:03:00.000Z",
      completedAt: "2026-08-10T08:05:00.000Z",
    } satisfies LearningSessionRecord;
    const backup = {
      format: "personal-phrase-bank",
      version: 4,
      exportedAt: "2026-08-10T09:00:00.000Z",
      categories: [],
      phrases: [],
      reviewLogs: [],
      trainingEvents: [],
      trainingSessions: [],
      phraseLearningStates: [learningState],
      activeSystemContentVersion: "2026-08-10",
      learningSessions: [learningSession],
    } satisfies BackupEnvelope;

    expect({ stages, phases, learningState, learningSession, backupVersion: backup.version }).toEqual({
      stages: ["unseen", "learning", "learned", "mastered"],
      phases: ["study", "test"],
      learningState,
      learningSession,
      backupVersion: 4,
    });
  });
});
