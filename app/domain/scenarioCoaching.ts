import { isTrainingEligiblePhrase } from "./dailyTask";
import type { Phrase, PhraseLearningState } from "./types";
import type { SpeakingScenario } from "./scenarios";

export interface ScenarioFeedback {
  taskCheck: "answered" | "partial" | "off-topic";
  summary: string;
  positive: string;
  improvements: Array<{ issue: string; suggestion: string; reason: string }>;
  improvedAnswer: string;
  translation: string;
  retryFocus: string;
  comparison?: string;
}
const shortText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
export function isScenarioFeedback(value: unknown): value is ScenarioFeedback {
  if (!value || typeof value !== "object") return false;
  const v = value as ScenarioFeedback;
  return ["answered", "partial", "off-topic"].includes(v.taskCheck)
    && shortText(v.summary, 300) && shortText(v.positive, 200)
    && shortText(v.improvedAnswer, 600) && shortText(v.translation, 400) && shortText(v.retryFocus, 200)
    && (v.comparison === undefined || shortText(v.comparison, 300))
    && Array.isArray(v.improvements) && v.improvements.length <= 2
    && v.improvements.every((i) => i && shortText(i.issue, 180) && shortText(i.suggestion, 300) && shortText(i.reason, 200));
}

// Specific communicative intent, not generic word overlap ("can", "you", etc.).
const intents: Record<string, RegExp[]> = {
  "meet-someone": [/first time|come here often/i, /what (?:do you do|about you)|work in|work as/i, /nice (?:talking|meeting)|great meeting|see you around/i],
  reschedule: [/something came up|reschedul|move .*(?:another|day|time)|make it/i, /(?:friday|tomorrow|afternoon|morning).*(?:work|free)|how about.*(?:day|time)/i, /see you (?:then|on)|put it.*calendar|send.*invite/i],
  clarify: [/repeat|say that again|catch that|more slowly/i, /do you mean|did you say|just to (?:check|confirm)/i, /got it|makes sense|thanks for clarifying/i],
  "order-food": [/could i (?:get|have)|i.d like.*(?:coffee|sandwich|salad|tea)/i, /without|on the side|less spicy|allergic/i, /(?:that.s|that is) all|to go|eat here/i],
  directions: [/get to|way to|nearest station/i, /change (?:trains|at)|which (?:line|stop)|transfer|nearest bus stop/i, /helpful|thanks.*(?:help|direction)|point.*direction/i],
  refund: [/returned|sent.*back|refund.*(?:status|received)/i, /tracking number|order number|proof of/i, /how long.*refund|refund.*take|when.*refund/i],
  "report-problem": [/isn.t working|doesn.t work|having trouble|problem with|keeps disconnecting/i, /(?:tried|reconnect).*|still not working/i, /somewhere else|in the meantime|alternative/i],
  "say-no": [/can.t.*(?:help|make|take)|not able to|afraid.*can.t|already.*plans/i, /how about.*weekend|another time|i.d love to/i, /sounds good|let me know.*time/i],
  "introduce-products": [/supply|source|product range|we (?:offer|provide)/i, /specification|what.*looking for|which.*product|product requirements|reference photo/i, /send.*(?:options|quote)|once.*confirm|catalog/i],
  "quote-moq": [/quote|quotation|price.*(?:quantity|spec)|confirm.*(?:quantity|spec)/i, /minimum order|moq/i, /(?:price|quote).*(?:shipping|freight)|shipping.*(?:separate|quote)|delivery postcode/i],
  "send-samples": [/(?:which|what).*model|how many samples|sample.*(?:available|try)/i, /(?:ship|send).*(?:sample|payment)|sample.*payment|delivery address/i, /tracking (?:number|details)|once.*(?:shipped|on its way)/i],
  "delivery-issue": [/sorry to hear|send.*(?:photo|picture|video)|how many.*affected/i, /review.*details|replacement|solution/i, /follow up|keep.*updated|update you/i],
};

export function matchLearnedPhrases(scenario: SpeakingScenario, phrases: Phrase[], states: PhraseLearningState[]): Phrase[][] {
  const byId = new Map(states.map((s) => [s.phraseId, s]));
  const eligible = phrases.filter((p) => isTrainingEligiblePhrase(p, byId.get(p.id)));
  return scenario.turns.map((_, index) => eligible.filter((p) => intents[scenario.id]?.[index]?.test(p.english))
    .sort((a, b) => (byId.get(a.id)?.stage === "mastered" ? 1 : 0) - (byId.get(b.id)?.stage === "mastered" ? 1 : 0) || a.english.length - b.english.length || a.id.localeCompare(b.id))
    .slice(0, 2));
}
export const normalizedExpression = (text: string) => text.normalize("NFKC").trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[.!?。！？]+$/g, "").replace(/\s+/g, " ");
export interface ScenarioReviewInput { english: string; chinese: string; sourceNote: string }
