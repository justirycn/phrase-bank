export interface StarterPhrase {
  id: string;
  english: string;
  chinese: string;
  categoryId: "daily" | "travel" | "social";
  personalExample: string;
}

export const STARTER_PHRASES: StarterPhrase[] = [
  { id: "starter-daily-not-sure", english: "I'm not entirely sure yet.", chinese: "我还不是完全确定。", categoryId: "daily", personalExample: "I'm not entirely sure yet, but I'll let you know tonight." },
  { id: "starter-daily-take-time", english: "Let me take some time to think about it.", chinese: "让我花点时间考虑一下。", categoryId: "daily", personalExample: "Let me take some time to think about it before I decide." },
  { id: "starter-daily-sounds-good", english: "That sounds good to me.", chinese: "我觉得这个安排不错。", categoryId: "daily", personalExample: "Dinner at seven? That sounds good to me." },
  { id: "starter-daily-up-to-you", english: "It's completely up to you.", chinese: "完全由你决定。", categoryId: "daily", personalExample: "We can eat here or go somewhere else—it's completely up to you." },
  { id: "starter-daily-no-rush", english: "There's no rush.", chinese: "不用着急。", categoryId: "daily", personalExample: "Send me the details when you have time; there's no rush." },
  { id: "starter-daily-get-back", english: "I'll get back to you as soon as I can.", chinese: "我会尽快回复你。", categoryId: "daily", personalExample: "I need to check my schedule, and I'll get back to you as soon as I can." },
  { id: "starter-daily-makes-sense", english: "That makes a lot of sense.", chinese: "这很有道理。", categoryId: "daily", personalExample: "Now that you've explained it, that makes a lot of sense." },
  { id: "starter-daily-used-to", english: "I'm still getting used to it.", chinese: "我还在适应。", categoryId: "daily", personalExample: "The new routine is fine, but I'm still getting used to it." },
  { id: "starter-daily-looking-forward", english: "I've been looking forward to this.", chinese: "我一直很期待这件事。", categoryId: "daily", personalExample: "I've been looking forward to this trip for months." },
  { id: "starter-daily-depends", english: "It depends on how much time we have.", chinese: "这取决于我们有多少时间。", categoryId: "daily", personalExample: "We could visit both places, but it depends on how much time we have." },
  { id: "starter-daily-not-mind", english: "I wouldn't mind giving it a try.", chinese: "我不介意试一试。", categoryId: "daily", personalExample: "I've never tried that restaurant, but I wouldn't mind giving it a try." },
  { id: "starter-daily-keep-posted", english: "Keep me posted.", chinese: "有进展随时告诉我。", categoryId: "daily", personalExample: "Keep me posted if the plan changes." },
  { id: "starter-daily-work-out", english: "I'm sure we'll work something out.", chinese: "我相信我们会想出办法的。", categoryId: "daily", personalExample: "Our schedules are different, but I'm sure we'll work something out." },
  { id: "starter-daily-catch-up", english: "We should catch up sometime.", chinese: "我们改天应该聚一聚、聊聊近况。", categoryId: "daily", personalExample: "It's been ages—we should catch up sometime." },
  { id: "starter-daily-happen", english: "It happens from time to time.", chinese: "这种事偶尔会发生。", categoryId: "daily", personalExample: "Don't worry about being late; it happens from time to time." },
  { id: "starter-daily-point", english: "I see your point.", chinese: "我明白你的意思。", categoryId: "daily", personalExample: "I see your point, although I still prefer the first option." },
  { id: "starter-daily-not-big-deal", english: "It's not a big deal.", chinese: "这没什么大不了的。", categoryId: "daily", personalExample: "You forgot to call, but it's not a big deal." },
  { id: "starter-daily-come-up", english: "Something came up at the last minute.", chinese: "临时出了点状况。", categoryId: "daily", personalExample: "I had to cancel because something came up at the last minute." },
  { id: "starter-daily-feel-like", english: "I don't really feel like going out tonight.", chinese: "我今晚不太想出门。", categoryId: "daily", personalExample: "It's been a long day, so I don't really feel like going out tonight." },
  { id: "starter-daily-for-now", english: "That should be enough for now.", chinese: "目前这些应该够了。", categoryId: "daily", personalExample: "We've bought the essentials, so that should be enough for now." },
  { id: "starter-daily-meant-to", english: "I've been meaning to ask you something.", chinese: "我一直想问你一件事。", categoryId: "daily", personalExample: "I've been meaning to ask you something about your new job." },
  { id: "starter-daily-rather", english: "I'd rather keep things simple.", chinese: "我更愿意把事情保持简单。", categoryId: "daily", personalExample: "For this weekend, I'd rather keep things simple and stay nearby." },
  { id: "starter-daily-figure-out", english: "I'll figure it out along the way.", chinese: "我会边做边想办法。", categoryId: "daily", personalExample: "I don't have every detail planned, but I'll figure it out along the way." },
  { id: "starter-daily-worth-it", english: "It was definitely worth it.", chinese: "这绝对值得。", categoryId: "daily", personalExample: "The hike was tiring, but the view was definitely worth it." },

  { id: "starter-travel-check-in", english: "I'd like to check in, please.", chinese: "我想办理入住。", categoryId: "travel", personalExample: "Hi, I'd like to check in, please. The booking is under Xie." },
  { id: "starter-travel-reservation", english: "I have a reservation under this name.", chinese: "我用这个名字预订了。", categoryId: "travel", personalExample: "I have a reservation under this name for three nights." },
  { id: "starter-travel-get-there", english: "What's the easiest way to get there?", chinese: "去那里最方便的方式是什么？", categoryId: "travel", personalExample: "What's the easiest way to get there from the airport?" },
  { id: "starter-travel-walking-distance", english: "Is it within walking distance?", chinese: "走路能到吗？", categoryId: "travel", personalExample: "Is the old town within walking distance from here?" },
  { id: "starter-travel-recommend", english: "Is there anywhere nearby you'd recommend?", chinese: "附近有你推荐的地方吗？", categoryId: "travel", personalExample: "Is there anywhere nearby you'd recommend for a quiet dinner?" },
  { id: "starter-travel-getting-around", english: "What's the best way to get around?", chinese: "在这里出行最好的方式是什么？", categoryId: "travel", personalExample: "What's the best way to get around without renting a car?" },
  { id: "starter-travel-leave-luggage", english: "Could I leave my luggage here for a few hours?", chinese: "我可以把行李寄存在这里几个小时吗？", categoryId: "travel", personalExample: "Could I leave my luggage here for a few hours after checkout?" },
  { id: "starter-travel-take-look", english: "Could you take a look at this for me?", chinese: "你能帮我看一下这个吗？", categoryId: "travel", personalExample: "My room key isn't working. Could you take a look at this for me?" },
  { id: "starter-travel-avoid", english: "Is there anything I should avoid?", chinese: "有什么我应该避开的吗？", categoryId: "travel", personalExample: "Is there anything I should avoid doing in this area at night?" },
  { id: "starter-travel-flexible", english: "My dates are fairly flexible.", chinese: "我的日期比较灵活。", categoryId: "travel", personalExample: "My dates are fairly flexible, so I can travel a day earlier." },
  { id: "starter-travel-missed", english: "I think I may have missed my stop.", chinese: "我想我可能坐过站了。", categoryId: "travel", personalExample: "Excuse me, I think I may have missed my stop." },
  { id: "starter-travel-split-bill", english: "Could we split the bill, please?", chinese: "我们可以分开结账吗？", categoryId: "travel", personalExample: "Could we split the bill, please? I'll pay for these two items." },

  { id: "starter-social-how-going", english: "How have things been going lately?", chinese: "最近过得怎么样？", categoryId: "social", personalExample: "It's good to see you again. How have things been going lately?" },
  { id: "starter-social-heard", english: "I've heard a lot of good things about it.", chinese: "我听说过很多关于它的好评。", categoryId: "social", personalExample: "I've heard a lot of good things about the city, but I've never been." },
  { id: "starter-social-common", english: "It sounds like we have a lot in common.", chinese: "听起来我们有很多共同点。", categoryId: "social", personalExample: "We both enjoy hiking and good coffee—it sounds like we have a lot in common." },
  { id: "starter-social-stay-touch", english: "Let's stay in touch.", chinese: "我们保持联系吧。", categoryId: "social", personalExample: "It was great meeting you. Let's stay in touch." },
];
