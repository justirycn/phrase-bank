import { describe, expect, it } from "vitest";
import type { DailyTrainingSummary, SpeechPreferences, TrainingEvent, TrainingSessionRecord } from "../../app/domain/types";

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
});
