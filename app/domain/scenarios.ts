import { isScenarioFeedback, type ScenarioFeedback } from "./scenarioCoaching";

export interface DialogueTurn {
  question: string;
  translation: string;
  task: string;
  keywords: string[];
  answer: string;
  answerTranslation: string;
}
export interface SpeakingScenario {
  id: string;
  version: 1;
  category: "daily" | "trade";
  title: string;
  partner: string;
  role: string;
  goal: string;
  turns: DialogueTurn[];
}
const turn = (question: string, translation: string, task: string, keywords: string[], answer: string, answerTranslation: string): DialogueTurn => ({ question, translation, task, keywords, answer, answerTranslation });
const scenario = (id: string, category: SpeakingScenario["category"], title: string, partner: string, role: string, goal: string, turns: DialogueTurn[]): SpeakingScenario => ({ id, version: 1, category, title, partner, role, goal, turns });

// Curated, scripted practice. Business details are examples, never real commitments.
export const SPEAKING_SCENARIOS: SpeakingScenario[] = [
  scenario("meet-someone", "daily", "和新朋友聊几句", "新认识的朋友", "你", "介绍自己、接住话题，再自然结束聊天。", [
    turn("Hi, is this your first time here?", "你好，你是第一次来这里吗？", "说这是第一次来，顺便问问对方。", ["第一次", "反问"], "Yes, it is. How about you? Do you come here often?", "是的。你呢？你经常来吗？"),
    turn("I come here most weekends. What do you do?", "我大多数周末会来。你做什么工作？", "简单介绍工作，再问对方的情况。", ["介绍工作", "继续交流"], "I work in international trade. What about you?", "我做外贸。你呢？"),
    turn("I work in design. It was nice talking to you!", "我是做设计的。很高兴和你聊天！", "友好地结束聊天，说下次再见。", ["很高兴认识", "下次见"], "You too! It was great meeting you. Hope to see you around.", "我也是！很高兴认识你，希望下次还能见到。"),
  ]),
  scenario("reschedule", "daily", "约时间与临时改期", "朋友", "你", "解释时间冲突，提议替代时间并确认。", [
    turn("Are we still on for lunch tomorrow?", "明天我们还一起吃午饭吗？", "说明临时有事，礼貌提出改时间。", ["临时有事", "改时间"], "Something came up. Could we move it to another day?", "我临时有点事，可以改天吗？"),
    turn("Sure. When works for you?", "当然。你什么时候方便？", "提议周五，问对方是否方便。", ["周五", "确认方便"], "Would Friday work for you? I'm free after twelve.", "周五你方便吗？我十二点以后有空。"),
    turn("Friday at one sounds good.", "周五一点可以。", "确认时间，并感谢对方配合。", ["确认", "感谢"], "Great, Friday at one it is. Thanks for being flexible.", "好，那就周五一点。谢谢你愿意调整。"),
  ]),
  scenario("clarify", "daily", "没听清，也能接着聊", "对话伙伴", "你", "请对方重复、核对意思，并确认下一步。", [
    turn("Let's meet by the entrance on the other side.", "我们在另一边的入口见。", "没听清，请对方再说一遍。", ["没听清", "重复"], "Sorry, I didn't catch that. Could you say it again?", "不好意思，我没听清。可以再说一遍吗？"),
    turn("The entrance across from the coffee shop.", "咖啡店对面的入口。", "确认对方指的是正对咖啡店的入口。", ["确认位置", "核对理解"], "Do you mean the entrance right across from the coffee shop?", "你是说正对着咖啡店的那个入口吗？"),
    turn("Exactly. I'll wait there.", "对，我会在那里等。", "表示明白，说你马上过去。", ["明白", "马上到"], "Got it. I'll be there in a few minutes.", "明白了，我几分钟就到。"),
  ]),
  scenario("order-food", "daily", "点餐与表达偏好", "服务员", "你 · 顾客", "点一份餐，说明偏好并确认订单。", [
    turn("Hi! What can I get you?", "你好！想要点什么？", "点一个鸡肉三明治和一杯水。", ["点餐", "饮品"], "Could I have a chicken sandwich and a glass of water, please?", "请给我一个鸡肉三明治和一杯水。"),
    turn("Would you like anything changed?", "有什么需要调整的吗？", "说明不要洋葱，酱汁另外放。", ["不要洋葱", "酱汁另放"], "No onions, please. Could I get the sauce on the side?", "请不要放洋葱，酱汁可以另外放吗？"),
    turn("Of course. Is that for here or to go?", "当然。在这里吃还是带走？", "选择带走，并确认多久能好。", ["带走", "等多久"], "To go, please. About how long will it take?", "带走，谢谢。大概需要多久？"),
  ]),
  scenario("directions", "daily", "问路与确认交通", "路人", "你", "问清路线、换乘地点和预计时间。", [
    turn("Hi, do you need a hand?", "你好，需要帮忙吗？", "说明你要去火车站，请教路线。", ["目的地", "怎么走"], "Yes, please. What's the best way to get to the train station?", "是的，谢谢。去火车站怎么走比较方便？"),
    turn("Take the bus, then change at Central Square.", "坐公交，到中心广场换乘。", "核对换乘地点，再问公交站在哪里。", ["核对地点", "公交站"], "So I change at Central Square? Where's the nearest bus stop?", "所以我在中心广场换乘？最近的公交站在哪里？"),
    turn("Just around the corner. The trip takes about twenty minutes.", "就在拐角处。全程大约二十分钟。", "表达感谢，确认自己理解了。", ["感谢", "确认"], "That's really helpful. Thanks for pointing me in the right direction.", "太有帮助了，谢谢你给我指路。"),
  ]),
  scenario("refund", "daily", "退货后，查询退款", "客服", "你 · 顾客", "说明退货情况，核对记录，问清处理时间。", [
    turn("How can I help you today?", "今天有什么可以帮你？", "解释已经寄回退货，但网站仍显示未收到。", ["已寄回", "状态未更新"], "I sent my return back on Tuesday, but it still says you haven't received it. Could you check?", "我周二寄回了退货，但仍显示你们没收到，可以查一下吗？"),
    turn("Do you have the tracking number?", "你有运单号吗？", "表示有运单号，并说明物流显示已经签收。", ["运单号", "显示签收"], "Yes, I have it here. The tracking says it was delivered yesterday.", "有，就在这里。物流显示昨天已送达。"),
    turn("I can see it now. Your refund is being processed.", "现在查到了，退款正在处理中。", "询问大概多久能收到退款。", ["处理时间", "感谢"], "Thanks for checking. When should I expect the refund?", "谢谢你帮我查。大概什么时候能收到退款？"),
  ]),
  scenario("report-problem", "daily", "把遇到的问题说清楚", "工作人员", "你", "描述问题、补充细节，并请求可行的帮助。", [
    turn("What's the problem?", "是什么问题？", "说明房间 Wi-Fi 一直断开。", ["房间", "反复断线"], "The Wi-Fi in my room keeps disconnecting.", "我房间里的 Wi-Fi 一直断开。"),
    turn("Have you tried reconnecting?", "你试过重新连接吗？", "说明已经试过，问题仍在。", ["已经尝试", "仍然不行"], "Yes, I've tried a few times, but it's still not working.", "试过好几次了，但还是不行。"),
    turn("I'll ask someone to take a look.", "我会请人来看一下。", "表示感谢，问有没有暂时的替代方案。", ["感谢", "替代方案"], "Thank you. Is there somewhere else I can get online in the meantime?", "谢谢。在这期间，有没有其他地方可以上网？"),
  ]),
  scenario("say-no", "daily", "礼貌拒绝，也给个选择", "朋友", "你", "说明限制，友好拒绝并提出替代安排。", [
    turn("Would you like to join us for dinner tonight?", "今晚想和我们一起吃饭吗？", "感谢邀请，说明今晚已经有安排。", ["感谢邀请", "已有安排"], "Thanks for inviting me, but I already have plans tonight.", "谢谢你邀请我，但我今晚已经有安排了。"),
    turn("No worries. Maybe another time?", "没关系，那改天？", "表明愿意，提出周末见面。", ["愿意", "周末"], "I'd love to. How about sometime this weekend?", "我很愿意。这个周末找个时间怎么样？"),
    turn("Saturday could work. I'll text you.", "周六应该可以，我发消息给你。", "同意等消息，再次感谢。", ["确认", "保持联系"], "Sounds good. Let me know what time works for everyone.", "好啊。大家方便的时间确定后告诉我。"),
  ]),
  scenario("introduce-products", "trade", "介绍产品与供货能力", "海外客户", "你 · 中国供货方", "说明能提供什么，再了解客户的真实需求。", [
    turn("Could you tell me a little about your business?", "可以简单介绍一下你的业务吗？", "说明在中国做产品采购和供货，避免虚构工厂身份。", ["中国", "采购与供货"], "We're based in China and help customers source products from local suppliers.", "我们在中国，帮助客户从本地供应商采购产品。"),
    turn("What kinds of products can you help with?", "你们能提供哪些产品？", "请对方提供产品需求或参考图，以便确认。", ["产品要求", "参考图片"], "Could you share your product requirements or a reference photo? I'll check what we can offer.", "可以发一下产品要求或参考图吗？我会确认我们能提供什么。"),
    turn("I'll send you the details. What's the next step?", "我会发详细信息，下一步是什么？", "说明确认要求后再提供选择和报价。", ["确认需求", "选择与报价"], "Once we confirm the specifications, I'll send you some options and a quote.", "确认规格后，我会给你一些选择和报价。"),
  ]),
  scenario("quote-moq", "trade", "报价与确认起订量", "海外客户", "你 · 中国供货方", "先确认规格与数量，再解释报价的条件。", [
    turn("Could you give me your best price?", "可以报一个最优惠的价格吗？", "先确认需要的规格和数量。", ["规格", "数量"], "Could you confirm the specifications and the quantity you need?", "可以确认一下你需要的规格和数量吗？"),
    turn("We're thinking of a small trial order. What's your minimum?", "我们想先下小批量试单。最低多少？", "说明需要核实起订量，不编造确定数字。", ["试单", "核实起订量"], "Let me check the minimum order quantity for that model. We may be able to arrange a trial order.", "我确认一下这个型号的起订量，我们可能可以安排试单。"),
    turn("Does the price include shipping?", "这个价格包含运费吗？", "本例报价不含运费，索取邮编后核算。", ["运费另计", "目的地邮编"], "Shipping is quoted separately. Could you send me the delivery postcode so I can work it out?", "运费单独报价。可以发收件邮编，方便我计算吗？"),
  ]),
  scenario("send-samples", "trade", "寄样与确认交期", "海外客户", "你 · 中国供应商", "确认样品需求，说明寄出条件，再核对收件信息。", [
    turn("Can I get a sample before placing an order?", "下单之前可以先拿一个样品吗？", "表示可以先寄样，并确认型号和数量。", ["先寄样", "型号", "数量"], "Of course. Which model would you like to try, and how many samples do you need?", "当然。你想试哪个型号，需要几个样品？"),
    turn("When can you send the samples?", "你们什么时候能寄出样品？", "告诉对方：收到样品费后安排寄出，并请他确认收件地址。", ["付款", "寄样", "收件信息"], "We'll ship the samples once we receive the sample payment. Could you confirm your delivery address?", "收到样品费后我们会安排寄出。可以确认一下收件地址吗？"),
    turn("Sure. Can you send me the tracking details?", "当然，可以把物流信息发给我吗？", "说明包裹寄出后提供运单号，避免承诺未确认的到货日期。", ["寄出后", "运单号"], "I'll send you the tracking number once the package is on its way.", "包裹寄出后，我会把运单号发给你。"),
  ]),
  scenario("delivery-issue", "trade", "处理延误与质量反馈", "海外客户", "你 · 中国供货方", "接住反馈，收集信息，明确后续跟进。", [
    turn("Our order arrived late, and some items are damaged.", "订单晚到了，而且有些产品损坏。", "表达歉意，请对方提供受影响数量和照片。", ["回应问题", "数量", "照片"], "I'm sorry to hear that. Could you send photos and let me know how many items are affected?", "很抱歉听到这个情况。可以发照片并告诉我有多少件受影响吗？"),
    turn("I'll send them over. What can you do about it?", "我会发给你，你们能怎么处理？", "说明先核实，再讨论补发或其他方案。", ["先核实", "处理方案"], "Let me review the details first. Then we can discuss a replacement or another solution.", "我先核实详细情况，然后我们可以讨论补发或其他解决方案。"),
    turn("Please keep me updated.", "请随时告诉我进展。", "承诺有进展及时反馈，不编造具体处理时限。", ["主动跟进", "及时反馈"], "Of course. I'll follow up with the supplier and update you as soon as I hear back.", "当然。我会跟供应商跟进，收到回复就及时告诉你。"),
  ]),
];

export const findScenario = (id: string) => SPEAKING_SCENARIOS.find((item) => item.id === id);
export type SpeakingRating = "again" | "partial" | "independent";
export interface SpeakingAttempt {
  id: string; turn: number; usedHint: boolean; practiced: boolean; recorded: boolean; rating?: SpeakingRating;
  transcript?: string;
  feedback?: ScenarioFeedback;
}
export interface ScenarioSession {
  id: string; scenarioId: string; version: 1; turn: number; attempts: SpeakingAttempt[];
  focusedTurns: number[]; startedAt: string; updatedAt: string; completedAt?: string;
}
export interface ScenarioProgress { sessions: ScenarioSession[] }
export const currentAttempt = (session: ScenarioSession) => session.attempts[session.attempts.length - 1];
export function newScenarioSession(scenarioId: string): ScenarioSession {
  if (!findScenario(scenarioId)) throw new Error("找不到这个场景");
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), scenarioId, version: 1, turn: 0, attempts: [{ id: crypto.randomUUID(), turn: 0, usedHint: false, practiced: false, recorded: false }], focusedTurns: [], startedAt: now, updatedAt: now };
}
export type ScenarioAction = { type: "hint" } | { type: "practice"; recorded: boolean } | { type: "rate"; rating: SpeakingRating } | { type: "retry" } | { type: "next" } | { type: "focus"; turn: number }
  | { type: "transcript"; text: string } | { type: "feedback"; text: string; feedback: ScenarioFeedback };
export function updateScenario(session: ScenarioSession, action: ScenarioAction): ScenarioSession {
  const next = structuredClone(session);
  const attempt = currentAttempt(next);
  const template = findScenario(next.scenarioId)!;
  if (action.type === "focus") {
    if (!Number.isInteger(action.turn) || action.turn < 0 || action.turn >= template.turns.length) return session;
    next.focusedTurns = next.focusedTurns.includes(action.turn) ? next.focusedTurns.filter((index) => index !== action.turn) : [...next.focusedTurns, action.turn].slice(0, 3);
  } else {
    if (session.completedAt) return session;
    if (action.type === "hint") { attempt.usedHint = true; if (attempt.rating === "independent") attempt.rating = undefined; }
    if (action.type === "practice") { attempt.practiced = true; attempt.recorded = action.recorded; }
    if (action.type === "transcript") {
      if (!attempt.practiced || !action.text.trim() || action.text.length > 1800) return session;
      if (attempt.transcript !== action.text.trim()) attempt.feedback = undefined;
      attempt.transcript = action.text.trim();
    }
    if (action.type === "feedback") {
      if (!attempt.practiced || attempt.transcript !== action.text || !isScenarioFeedback(action.feedback)) return session;
      attempt.feedback = action.feedback;
      attempt.usedHint = true;
      if (attempt.rating === "independent") attempt.rating = undefined;
    }
    if (action.type === "rate") {
      if (!attempt.practiced || (action.rating === "independent" && attempt.usedHint)) return session;
      attempt.rating = action.rating;
    }
    if (action.type === "retry") {
      if (next.attempts.length >= 18) return session;
      next.attempts.push({ id: crypto.randomUUID(), turn: next.turn, usedHint: false, practiced: false, recorded: false });
    }
    if (action.type === "next") {
      if (!attempt.practiced || !attempt.rating) return session;
      if (next.turn === template.turns.length - 1) next.completedAt = new Date().toISOString();
      else { next.turn += 1; next.attempts.push({ id: crypto.randomUUID(), turn: next.turn, usedHint: false, practiced: false, recorded: false }); }
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function isScenarioProgress(value: unknown): value is ScenarioProgress {
  if (!value || typeof value !== "object" || !("sessions" in value) || !Array.isArray(value.sessions) || value.sessions.length > 30) return false;
  const ids = new Set<string>();
  return value.sessions.every((s: ScenarioSession) => {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.length > 80 || ids.has(s.id)) return false;
    ids.add(s.id);
    const template = findScenario(s.scenarioId);
    if (!template || s.version !== 1 || !Number.isInteger(s.turn) || s.turn < 0 || s.turn >= template.turns.length) return false;
    if (![s.startedAt, s.updatedAt, ...(s.completedAt ? [s.completedAt] : [])].every((v) => typeof v === "string" && v.length < 40 && Number.isFinite(Date.parse(v)))) return false;
    if (!Array.isArray(s.focusedTurns) || s.focusedTurns.length > 3 || !s.focusedTurns.every((v) => Number.isInteger(v) && v >= 0 && v < template.turns.length)) return false;
    if (!Array.isArray(s.attempts) || s.attempts.length < 1 || s.attempts.length > 93) return false;
    const attemptIds = new Set<string>();
    if (!s.attempts.every((a) => {
      if (!a || typeof a.id !== "string" || a.id.length > 80 || attemptIds.has(a.id)) return false;
      attemptIds.add(a.id);
      if (a.transcript !== undefined && (typeof a.transcript !== "string" || !a.transcript.trim() || a.transcript.length > 1800 || !a.practiced)) return false;
      if (a.feedback !== undefined && (!a.transcript || !a.usedHint || !isScenarioFeedback(a.feedback))) return false;
      return Number.isInteger(a.turn) && a.turn >= 0 && a.turn <= s.turn && typeof a.usedHint === "boolean" && typeof a.practiced === "boolean" && typeof a.recorded === "boolean" && (!a.recorded || a.practiced) && (a.rating === undefined || (["again", "partial", "independent"].includes(a.rating) && a.practiced)) && !(a.rating === "independent" && a.usedHint);
    })) return false;
    return currentAttempt(s).turn === s.turn && (!s.completedAt || (s.turn === template.turns.length - 1 && template.turns.every((_, index) => s.attempts.some((a) => a.turn === index && a.rating))));
  });
}

export function preservesScenarioHistory(previous: ScenarioProgress, next: ScenarioProgress): boolean {
  return previous.sessions.every((old) => {
    const updated = next.sessions.find((s) => s.id === old.id);
    if (!updated) return Boolean(old.completedAt); // Completed history may be trimmed to 30 sessions.
    return updated.scenarioId === old.scenarioId && updated.turn >= old.turn && (!old.completedAt || updated.completedAt === old.completedAt) && old.attempts.every((a) => {
      const b = updated.attempts.find((candidate) => candidate.id === a.id);
      return b && b.turn === a.turn && (!a.usedHint || b.usedHint) && (!a.practiced || b.practiced)
        // Older clients must not silently remove newly added transcript/feedback fields.
        && (!a.transcript || Boolean(b.transcript))
        && (!a.feedback || a.transcript !== b.transcript || Boolean(b.feedback));
    });
  });
}
