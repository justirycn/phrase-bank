export interface BilingualValue { en: string; zh: string }
export interface PhraseFamily { subcategory: string; intent: string; actions: BilingualValue[]; contexts: BilingualValue[] }
export interface CategoryBlueprint { id: "daily" | "travel" | "work" | "business" | "supply-chain" | "social"; families: PhraseFamily[] }
const p = (values: Array<[string, string]>): BilingualValue[] => values.map(([en, zh]) => ({ en, zh }));
const family = (subcategory: string, intent: string, actions: Array<[string, string]>, contexts: Array<[string, string]>): PhraseFamily => ({ subcategory, intent, actions: p(actions), contexts: p(contexts) });

export const BLUEPRINTS: CategoryBlueprint[] = [
  { id: "daily", families: [
    family("home-care", "handle a household task", [["clean", "清理"], ["organize", "整理"], ["check", "检查"]], [["the kitchen after dinner", "晚饭后的厨房"], ["the bedroom before our guests arrive", "客人到来前的卧室"], ["the bathroom this afternoon", "今天下午的浴室"], ["the storage cupboard", "储物柜"], ["the balcony this weekend", "周末的阳台"], ["the front door before bed", "睡前的前门"]]),
    family("food", "prepare food", [["prepare", "准备"], ["buy ingredients for", "购买食材来做"], ["make time for", "抽时间准备"]], [["breakfast before work", "上班前的早餐"], ["a quick lunch", "一顿简便午餐"], ["dinner for two", "两人晚餐"], ["a healthy snack", "健康零食"], ["tomorrow's meal", "明天的饭菜"], ["something for the weekend", "周末吃的东西"]]),
    family("shopping", "manage a purchase", [["buy", "购买"], ["compare prices for", "比较价格后购买"], ["look for", "寻找"]], [["some weekend groceries", "周末需要的日用品"], ["a new phone charger", "新的手机充电器"], ["a gift for my friend", "送给朋友的礼物"], ["comfortable walking shoes", "舒适的步行鞋"], ["a replacement light bulb", "替换灯泡"], ["a rain jacket", "雨衣"]]),
    family("appointments", "manage an appointment", [["book", "预订"], ["reschedule", "改期"], ["confirm", "确认"]], [["a dental appointment", "牙医预约"], ["a haircut for Saturday", "周六的理发预约"], ["a table for Friday evening", "周五晚上的餐位"], ["a health check", "体检预约"], ["a repair visit", "上门维修"], ["a call with my adviser", "与顾问的通话"]]),
    family("personal-admin", "complete personal administration", [["pay", "支付"], ["check", "确认"], ["follow up on", "跟进"]], [["the electricity bill", "电费"], ["my mobile phone plan", "手机套餐"], ["the package delivery", "包裹配送"], ["my refund request", "退款申请"], ["the bank transfer", "银行转账"], ["my insurance renewal", "保险续费"]]),
    family("health", "look after health", [["remember", "记得处理"], ["make time for", "抽时间做"], ["keep track of", "记录"]], [["my medicine after lunch", "午饭后的用药"], ["a short walk today", "今天的短途散步"], ["my water intake", "饮水量"], ["the exercises from my doctor", "医生建议的锻炼"], ["my sleep this week", "这周的睡眠"], ["a break from the screen", "离开屏幕休息一下"]]),
    family("planning", "make an everyday plan", [["plan", "规划"], ["review", "检查"], ["adjust", "调整"]], [["tomorrow's schedule", "明天的日程"], ["my weekend activities", "周末活动"], ["the route to the new office", "去新办公室的路线"], ["my budget for this month", "本月预算"], ["the chores for today", "今天的家务"], ["the timing for our dinner", "晚餐时间"]]),
    family("communication", "send an everyday message", [["reply to", "回复"], ["call", "打电话给"], ["send an update to", "向……发送最新消息"]], [["my landlord", "房东"], ["the delivery driver", "配送司机"], ["my family", "家人"], ["the clinic", "诊所"], ["our neighbour", "邻居"], ["the repair company", "维修公司"]]),
    family("returns", "resolve a purchase issue", [["return", "退回"], ["exchange", "更换"], ["ask for help with", "请求协助处理"]], [["the shirt that does not fit", "不合身的衬衫"], ["the damaged package", "损坏的包裹"], ["the wrong item", "发错的商品"], ["the late delivery", "延迟配送"], ["the duplicate charge", "重复扣款"], ["the missing accessory", "缺少的配件"]]),
    family("leaving-home", "prepare to leave", [["pack", "收拾"], ["double-check", "再次检查"], ["get ready with", "准备好"]], [["my work bag", "工作包"], ["the keys and wallet", "钥匙和钱包"], ["the documents I need", "需要的文件"], ["an umbrella", "雨伞"], ["a bottle of water", "一瓶水"], ["the shopping list", "购物清单"]]),
  ] },
  { id: "travel", families: [
    family("airport", "navigate an airport", [["find", "找到"], ["get directions to", "询问去往"]], [["the check-in desk", "值机柜台"], ["security screening", "安检处"], ["my departure gate", "登机口"], ["the baggage claim area", "行李提取区"], ["the airport shuttle stop", "机场接驳车站"]]),
    family("flight", "manage a flight", [["confirm", "确认"], ["change", "更改"]], [["my departure time", "起飞时间"], ["my seat", "座位"], ["the passenger name", "乘客姓名"], ["my checked baggage", "托运行李"], ["the connecting flight", "转机航班"]]),
    family("hotel", "manage a hotel stay", [["book", "预订"], ["ask about", "询问"]], [["a quiet room", "安静的房间"], ["an early check-in", "提前入住"], ["a late check-out", "延迟退房"], ["breakfast hours", "早餐时间"], ["luggage storage", "行李寄存"]]),
    family("rail", "take a train", [["check", "查看"], ["ask about", "询问"]], [["the next train", "下一班火车"], ["the platform number", "站台号"], ["a reserved seat", "预留座位"], ["the fastest route", "最快路线"], ["a delayed service", "延误班次"]]),
    family("local-transport", "use local transport", [["find", "找到"], ["arrange", "安排"]], [["a taxi to the airport", "去机场的出租车"], ["the nearest bus stop", "最近的公交站"], ["a ride to the hotel", "去酒店的车"], ["a day travel pass", "一日交通票"], ["the last metro train", "地铁末班车"]]),
    family("restaurant", "eat while travelling", [["reserve", "预订"], ["ask for", "请求"]], [["a table by the window", "靠窗餐位"], ["a vegetarian option", "素食选择"], ["the menu in English", "英文菜单"], ["the bill", "账单"], ["a recommendation", "推荐菜"]]),
    family("directions", "ask for directions", [["find", "找到"], ["get to", "前往"]], [["the city centre", "市中心"], ["the nearest pharmacy", "最近的药店"], ["the museum entrance", "博物馆入口"], ["the old town", "老城区"], ["the riverside market", "河边市场"]]),
    family("tickets", "manage a booking", [["change", "更改"], ["cancel", "取消"]], [["this reservation", "这笔预订"], ["my return ticket", "返程票"], ["the tour for tomorrow", "明天的行程"], ["the museum booking", "博物馆预订"], ["the rental car", "租车订单"]]),
    family("problems", "report a travel problem", [["report", "报告"], ["get help with", "请求协助处理"]], [["my missing suitcase", "丢失的行李箱"], ["a cancelled flight", "取消的航班"], ["the wrong hotel charge", "错误的酒店收费"], ["a lost passport", "遗失的护照"], ["a broken room key", "损坏的房卡"]]),
    family("information", "request travel information", [["check", "确认"], ["find out", "了解"]], [["the opening hours", "开放时间"], ["the local weather", "当地天气"], ["the entry requirements", "入境要求"], ["the tour meeting point", "旅行团集合点"], ["the best time to visit", "最佳游览时间"]]),
  ] },
  { id: "work", families: makeWorkFamilies() },
  { id: "business", families: makeBusinessFamilies() },
  { id: "supply-chain", families: makeSupplyFamilies() },
  { id: "social", families: makeSocialFamilies() },
];

function makeWorkFamilies(): PhraseFamily[] {
  const topics = [["the project scope", "项目范围"], ["the delivery timeline", "交付时间表"], ["the customer feedback", "客户反馈"], ["the next action", "下一步行动"]] as Array<[string, string]>;
  return ["planning", "meetings", "priorities", "progress", "feedback", "ownership", "risks", "decisions", "quality", "collaboration"].map((name, index) => family(name, "coordinate work", index % 2 ? [["clarify", "澄清"], ["document", "记录"], ["share", "分享"]] : [["review", "审阅"], ["discuss", "讨论"], ["confirm", "确认"]], topics));
}
function makeBusinessFamilies(): PhraseFamily[] {
  const topics = [["the price", "价格"], ["the payment terms", "付款条款"], ["the delivery date", "交付日期"], ["the warranty", "保修条款"], ["the final proposal", "最终方案"]] as Array<[string, string]>;
  return ["pricing", "payment", "delivery", "contract", "volume", "service", "warranty", "follow-up", "comparison", "agreement"].map((name, index) => family(name, "negotiate a business term", index % 2 ? [["clarify", "澄清"], ["reconsider", "重新考虑"]] : [["discuss", "讨论"], ["confirm", "确认"]], topics));
}
function makeSupplyFamilies(): PhraseFamily[] {
  const names = ["sample approval", "packaging review", "material sourcing", "production planning", "quality control", "supplier onboarding", "order confirmation", "shipment preparation", "delivery tracking", "issue resolution"];
  return names.map((name, index) => family(name, "coordinate product delivery", index % 2 ? [["inspect", "检查"], ["verify", "核实"]] : [["confirm", "确认"], ["update", "更新"]], (index < 5 ? [["the product sample", "产品样品"], ["the packaging", "包装"], ["the material specification", "材料规格"], ["the production schedule", "生产计划"]] : [["the minimum order quantity", "最小起订量"], ["the lead time", "交期"], ["the quality report", "质量报告"]]) as Array<[string, string]>));
}
function makeSocialFamilies(): PhraseFamily[] {
  const topics = [["how I feel", "我的感受"], ["what I need", "我的需要"], ["what happened yesterday", "昨天发生的事"]] as Array<[string, string]>;
  return ["feelings", "boundaries", "gratitude", "apology", "support"].map((name, index) => family(name, "express a social need", index % 2 ? [["talk honestly about", "坦诚谈谈"], ["set clear expectations about", "明确说明"]] : [["talk about", "谈谈"], ["make time to discuss", "抽时间讨论"]], topics));
}
