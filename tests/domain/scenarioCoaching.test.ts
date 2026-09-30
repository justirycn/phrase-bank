import { describe, expect, it } from "vitest";
import { isScenarioFeedback, matchLearnedPhrases, normalizedExpression } from "../../app/domain/scenarioCoaching";
import { currentAttempt, findScenario, isScenarioProgress, newScenarioSession, preservesScenarioHistory, updateScenario } from "../../app/domain/scenarios";
import { createNewPhrase } from "../../app/domain/review";
import type { PhraseLearningState } from "../../app/domain/types";
import { feedbackFixture } from "../fixtures/scenarioFeedback";

describe("scenario learning loop", () => {
  it("matches only relevant, learned, active and unlocked expressions", () => {
    const phrases = ["learned", "unseen", "retired", "locked", "unlocked", "irrelevant"].map((id) => ({ ...createNewPhrase({ english: id === "irrelevant" ? "Can you help me?" : "Is this your first time here?", chinese: "测试", categoryId: "daily" }), id,
      ...(id === "retired" ? { retiredAt: new Date().toISOString() } : {}), ...(["locked", "unlocked"].includes(id) ? { origin: "system" as const, kind: "example" as const, parentPhraseId: "parent" } : {}) }));
    const states: PhraseLearningState[] = phrases.map((p) => ({ phraseId: p.id, stage: p.id === "unseen" ? "unseen" : "learned", consecutiveGood: 0, masteredDates: [], updatedAt: new Date().toISOString(), ...(p.id === "unlocked" ? { unlockedAt: new Date().toISOString() } : {}) }));
    expect(matchLearnedPhrases(findScenario("meet-someone")!, phrases, states)[0].map((p) => p.id)).toEqual(["learned", "unlocked"]);
    expect(matchLearnedPhrases(findScenario("quote-moq")!, phrases, states).flat()).toHaveLength(0);
  });
  it("requires confirmed text, invalidates changed-text feedback and retains hint history on retry", () => {
    let s = newScenarioSession("meet-someone");
    expect(updateScenario(s, { type: "transcript", text: "Hello" })).toBe(s);
    s = updateScenario(s, { type: "practice", recorded: true });
    expect(updateScenario(s, { type: "feedback", text: "Hello", feedback: feedbackFixture })).toBe(s);
    s = updateScenario(s, { type: "transcript", text: "Hello" });
    s = updateScenario(s, { type: "rate", rating: "independent" });
    s = updateScenario(s, { type: "feedback", text: "Hello", feedback: feedbackFixture });
    expect(currentAttempt(s)).toMatchObject({ usedHint: true, transcript: "Hello", feedback: feedbackFixture });
    expect(currentAttempt(s).rating).toBeUndefined(); expect(isScenarioProgress({ sessions: [s] })).toBe(true);
    const legacy = structuredClone(s); delete currentAttempt(legacy).transcript; delete currentAttempt(legacy).feedback;
    expect(preservesScenarioHistory({ sessions: [s] }, { sessions: [legacy] })).toBe(false);
    const lostFeedback = structuredClone(s); delete currentAttempt(lostFeedback).feedback;
    expect(preservesScenarioHistory({ sessions: [s] }, { sessions: [lostFeedback] })).toBe(false);
    const edited = updateScenario(s, { type: "transcript", text: "Changed" });
    expect(currentAttempt(edited).feedback).toBeUndefined(); expect(currentAttempt(edited).usedHint).toBe(true);
    expect(preservesScenarioHistory({ sessions: [s] }, { sessions: [edited] })).toBe(true);
    const retry = updateScenario(s, { type: "retry" });
    expect(retry.attempts[0].feedback).toEqual(feedbackFixture);
    expect(currentAttempt(retry)).toMatchObject({ usedHint: false, practiced: false });
    expect(currentAttempt(retry).transcript).toBeUndefined();
  });
  it("validates structured advice and keeps old sessions compatible", () => {
    expect(isScenarioFeedback(feedbackFixture)).toBe(true);
    expect(isScenarioFeedback({ ...feedbackFixture, improvements: [{ issue: "bad" }] })).toBe(false);
    expect(isScenarioFeedback({ ...feedbackFixture, improvedAnswer: "x".repeat(601) })).toBe(false);
    expect(isScenarioProgress({ sessions: [newScenarioSession("refund")] })).toBe(true);
    expect(normalizedExpression("  That’s  fine! ")).toBe("that's fine");
  });
});
