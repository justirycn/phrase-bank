import type { ScenarioFeedback } from "../../app/domain/scenarioCoaching";
export const feedbackFixture: ScenarioFeedback = {
  taskCheck: "answered", summary: "回应了第一次来，也把话题递给了对方。", positive: "你主动反问了对方。",
  improvements: [{ issue: "缺少 be 动词", suggestion: "It's my first time here.", reason: "描述状态时需要 is。" }],
  improvedAnswer: "Yes, it's my first time here. How about you?", translation: "是的，我第一次来。你呢？", retryFocus: "把第一句说完整，再自然反问。",
};
