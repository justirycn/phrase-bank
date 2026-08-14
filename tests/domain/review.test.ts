import { describe, expect, it } from "vitest";
import { createNewPhrase, isReviewDueOnShanghaiDay, scheduleReview, shanghaiDayEndIso } from "../../app/domain/review";

const now = new Date("2026-08-07T08:00:00.000Z");

describe("review scheduling", () => {
  it("treats the whole Shanghai calendar day as due and rejects malformed dates", () => {
    const morning = new Date("2026-08-14T02:00:00.000Z");
    expect(isReviewDueOnShanghaiDay("2026-08-14T12:00:00.000Z", morning)).toBe(true);
    expect(isReviewDueOnShanghaiDay("2026-08-14T16:00:00.000Z", new Date("2026-08-14T15:59:59.999Z"))).toBe(false);
    expect(isReviewDueOnShanghaiDay("invalid", morning)).toBe(false);
    expect(shanghaiDayEndIso(morning)).toBe("2026-08-14T15:59:59.999Z");
  });

  it("makes a new phrase due immediately", () => {
    expect(createNewPhrase({ english: "I haven't decided yet.", chinese: "我还没决定。", categoryId: "daily" }, now).nextReviewAt).toBe(now.toISOString());
  });

  it("schedules again the next day, resets progress, and decrements mastery", () => {
    const phrase = { ...createNewPhrase({ english: "A", chinese: "甲", categoryId: "daily" }, now), reviewStep: 3, masteryLevel: 2 };
    const result = scheduleReview(phrase, "again", now);
    expect(result.phrase.reviewStep).toBe(0);
    expect(result.phrase.masteryLevel).toBe(1);
    expect(result.phrase.nextReviewAt).toBe("2026-08-08T08:00:00.000Z");
  });

  it("schedules hard the next day without advancing", () => {
    const phrase = { ...createNewPhrase({ english: "A", chinese: "甲", categoryId: "daily" }, now), reviewStep: 2 };
    const result = scheduleReview(phrase, "hard", now);
    expect(result.phrase.reviewStep).toBe(2);
    expect(result.phrase.nextReviewAt).toBe("2026-08-08T08:00:00.000Z");
  });

  it("advances good answers through 1, 3, 7, 14, 30 and 60 days", () => {
    const expected = [1, 3, 7, 14, 30, 60, 60];
    for (let step = 0; step < expected.length; step += 1) {
      const phrase = { ...createNewPhrase({ english: "A", chinese: "甲", categoryId: "daily" }, now), reviewStep: step };
      const result = scheduleReview(phrase, "good", now);
      const days = (new Date(result.phrase.nextReviewAt).getTime() - now.getTime()) / 86_400_000;
      expect(days).toBe(expected[step]);
    }
  });
});
