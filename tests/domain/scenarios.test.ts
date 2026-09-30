import { describe, expect, it } from "vitest";
import { currentAttempt, isScenarioProgress, newScenarioSession, preservesScenarioHistory, SPEAKING_SCENARIOS, updateScenario } from "../../app/domain/scenarios";

describe("scenario practice", () => {
  it("covers eight everyday and four seller-side trade situations, with coherent complete turns", () => {
    expect(SPEAKING_SCENARIOS.filter((s) => s.category === "daily")).toHaveLength(8);
    expect(SPEAKING_SCENARIOS.filter((s) => s.category === "trade")).toHaveLength(4);
    for (const scenario of SPEAKING_SCENARIOS) {
      expect(scenario.turns).toHaveLength(3);
      expect(scenario.turns.every((turn) => turn.question && turn.translation && turn.answer && turn.task)).toBe(true);
    }
  });
  it("blocks independent self-assessment after help and keeps hint history through retries", () => {
    let session = newScenarioSession("send-samples");
    session = updateScenario(session, { type: "hint" });
    session = updateScenario(session, { type: "practice", recorded: false });
    expect(updateScenario(session, { type: "rate", rating: "independent" })).toBe(session);
    const retried = updateScenario(session, { type: "retry" });
    expect(retried.attempts[0].usedHint).toBe(true);
    expect(currentAttempt(retried).usedHint).toBe(false);
    expect(preservesScenarioHistory({ sessions: [session] }, { sessions: [retried] })).toBe(true);
    const forged = structuredClone(session); currentAttempt(forged).usedHint = false;
    expect(preservesScenarioHistory({ sessions: [session] }, { sessions: [forged] })).toBe(false);
  });
  it("requires a real attempt and rating, completes only once, and validates persisted state", () => {
    let session = newScenarioSession("refund");
    expect(updateScenario(session, { type: "next" })).toBe(session);
    for (let index = 0; index < 3; index += 1) {
      session = updateScenario(session, { type: "practice", recorded: false });
      session = updateScenario(session, { type: "rate", rating: "partial" });
      session = updateScenario(session, { type: "next" });
    }
    expect(session.completedAt).toBeTruthy();
    expect(updateScenario(session, { type: "next" })).toBe(session);
    expect(isScenarioProgress({ sessions: [session] })).toBe(true);
    expect(isScenarioProgress({ sessions: [{ ...session, attempts: [] }] })).toBe(false);
    expect(isScenarioProgress({ sessions: [null] })).toBe(false);
  });
});
