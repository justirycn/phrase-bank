export const REORGANIZED_CONTENT_VERSION = "2026.08.5";

export const REORGANIZED_CATEGORY_PLAN = [
  {
    id: "daily",
    coreQuota: 240,
    threeExampleFamilies: 8,
    subcategories: [
      "greetings-and-check-ins", "everyday-reactions", "agreement", "disagreement",
      "clarification", "asking-favors", "offering-help", "thanking", "apologizing",
      "invitations", "making-plans", "changing-plans", "time-and-schedules",
      "home-and-chores", "food-and-cooking", "eating-out", "shopping",
      "returns-and-payments", "health-and-feeling-unwell", "weather",
      "transport-around-town", "phone-and-messages", "hobbies-and-free-time",
      "neighborhood-and-services",
    ],
    goals: [
      "start the exchange naturally", "ask a common question", "give a short natural response",
      "ask for clarification", "state a preference", "make a polite request",
      "offer or suggest something", "respond to a change or problem", "set a boundary politely",
      "close or move the exchange forward",
    ],
  },
  {
    id: "social",
    coreQuota: 120,
    threeExampleFamilies: 4,
    subcategories: [
      "small-talk", "meeting-new-people", "keeping-in-touch", "sharing-news",
      "feelings", "empathy-and-support", "compliments", "polite-refusals",
      "boundaries", "conflict-repair", "family-and-friends", "celebrations",
    ],
    goals: [
      "open naturally", "show friendly interest", "share something briefly", "react naturally",
      "agree without sounding formal", "disagree gently", "show empathy", "invite or include someone",
      "express a limit or need", "end warmly",
    ],
  },
  {
    id: "travel",
    coreQuota: 80,
    threeExampleFamilies: 3,
    subcategories: [
      "airport", "hotel", "directions", "local-transport", "restaurant",
      "tickets-and-bookings", "travel-problems", "sightseeing-and-local-advice",
    ],
    goals: [
      "make a simple request", "ask for essential information", "confirm a detail", "clarify what was said",
      "state a preference", "report a problem", "ask for an alternative", "check cost or timing",
      "respond politely", "finish the exchange clearly",
    ],
  },
  {
    id: "work",
    coreQuota: 80,
    threeExampleFamilies: 3,
    subcategories: [
      "workplace-small-talk", "meetings", "priorities", "progress-updates",
      "asking-for-clarification", "feedback", "collaboration", "problems-and-decisions",
    ],
    goals: [
      "open the conversation", "ask for an update", "give a concise update", "clarify responsibility",
      "check understanding", "raise a concern", "suggest a next step", "agree or disagree constructively",
      "ask for time or help", "confirm the outcome",
    ],
  },
  {
    id: "business",
    coreQuota: 40,
    threeExampleFamilies: 1,
    subcategories: ["pricing-and-terms", "negotiation", "proposals-and-follow-up", "customer-service"],
    goals: [
      "open professionally", "ask a direct question", "clarify a condition", "state a priority",
      "make a proposal", "respond to an objection", "ask for flexibility", "summarize an agreement",
      "follow up politely", "confirm the next step",
    ],
  },
  {
    id: "supply-chain",
    coreQuota: 40,
    threeExampleFamilies: 1,
    subcategories: [
      "introducing-products-and-capability", "inquiries-quotes-and-terms",
      "samples-customization-and-quality", "orders-production-and-shipping",
    ],
    goals: [
      "understand the buyer's need", "introduce a relevant product or capability", "offer a suitable option",
      "explain pricing or order terms", "discuss samples or customization", "set a realistic timeline",
      "reassure the buyer about quality", "handle a concern or change", "give a clear progress update",
      "confirm the next commercial step",
    ],
  },
] as const;

export type ReorganizedCategoryId = typeof REORGANIZED_CATEGORY_PLAN[number]["id"];

export const REORGANIZED_CORE_QUOTAS = Object.fromEntries(
  REORGANIZED_CATEGORY_PLAN.map(({ id, coreQuota }) => [id, coreQuota]),
) as Record<ReorganizedCategoryId, number>;

export const REORGANIZED_SUBCATEGORIES = new Set(
  REORGANIZED_CATEGORY_PLAN.flatMap(({ id, subcategories }) => subcategories.map((subcategory) => `${id}:${subcategory}`)),
);
