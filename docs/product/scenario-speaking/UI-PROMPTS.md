# 场景口语 UI 生成记录

日期：2026-09-29。工具：内置 Image Gen。状态：静态 UI 概念稿，未实现交互。

画面顺序与本次对话实际展示顺序一致：1 逐句引导；2 提纲表达；3 情景对话。

样式参考：仓库 `docs/audits/home-heatmap-performance/10-real-home-return-chrome-390x844.jpg` 与 `docs/audits/iphone13pro-speaking/04-answer-recording-playback.png`，均已直接查看并作为图片传入。这些是历史截图，不代表当前线上功能。

## 逐句引导

```text
Create realistic, production-quality UI designs with clear hierarchy, strong typography, and purposeful spacing.
Use case: ui-mockup. This is a design proposal for Phrase Bank, an existing Chinese learner's English web app. One independent mobile screen concept, not implemented. Current date anchor: 2026-09-29, do not display a calendar or dates. Target viewport 390 x 844, render at 2x (780 x 1688) if needed preserving exact aspect ratio. Mobile app content only. No phone bezel, notch, OS status, browser chrome, home indicator, rounded device mask, outer canvas, device shadows, multi-screen collage or marketing title. Full bleed app surface.
Attached images are STYLE references only, historical captures of this actual app. Use their restrained editorial typography, warm cream background, forest green text and rounded controls, not their old content, obsolete stats, enormous sentence text or overflowing layout.
Exact existing color tokens: background #fbf8f0, paper #fffdf8, primary ink #0b4a3a, secondary ink #29594c, burnt orange #d66f3f, muted #737a76, divider #ddd9cf. Body text around 15px; Chinese headings 26-32px maximum, English practice text around 25px. Two fonts max, clean Chinese sans with readable English. Use spacing and fine dividers first; no nested cards, no excessive panels, gradients, decorations, badges or invented scores. Tiny consistent outlined icons. Generous but functional whitespace.
The user learns both common daily English and overseas trade. The scene shown is a hypothetical Chinese supplier communicating with an overseas customer about sending samples; all delivery promises are clearly examples. Maintain just one main CTA and up to two supporting actions. Buttons 48px or taller, content must not overlap bottom action, bottom padding at least 24px. No fake numeric AI pronunciation score, no confetti, avatar illustration, decorative photo or waveforms when not recording. Clear legible simplified Chinese copy. Include a small quiet top caption "界面提案" to distinguish concept.
Direction name: 逐句引导. Guided rehearsal, focused on one sentence at a time.
Top bar: back chevron left, title "场景口语", tiny "界面提案" at right.
Below a compact horizontal progress row "听懂   /   跟读   /   自己说", highlight "跟读" in forest green with thin progress underline.
Small eyebrow in burnt orange "寄样与确认交期"; top supporting text "第 2 / 5 句".
Main content in upper middle: simple contextual heading "先把这一句说顺" and small Chinese "收到样品费后，我们会安排寄出。".
Larger English sentence across 4 readable lines, left aligned:
"We’ll ship the samples
once we receive
the sample payment."
Treat line wrapping naturally. Emphasize "once we receive" with a very subtle tinted underline.
Under sentence, a single subtle playback row with speaker icon "听参考发音" and "1.0×" small at right. No enclosing card.
A fine divider and a short helpful rhythm note in smaller text "把 once we receive 连起来说。".
Lower section intentionally calm with microphone outline and centered small label "听一遍，再跟着说一遍".
Bottom anchored safe action area: wide forest green rounded button "录下我的跟读"; supporting text button below "不方便录音，直接跟读".
Above bottom button show small "录音仅供本次回听".
No bottom navigation during training. Show no exact mastery evaluation, no next step button before a first attempt. Refined, warm, highly usable mobile screen.
```

## 提纲表达

```text
Create realistic, production-quality UI designs with clear hierarchy, strong typography, and purposeful spacing.
Use case: ui-mockup. This is a design proposal for Phrase Bank, an existing Chinese learner's English web app. One independent mobile screen concept, not implemented. Current date anchor: 2026-09-29, do not display a calendar or dates. Target viewport 390 x 844, render at 2x (780 x 1688) if needed preserving exact aspect ratio. Mobile app content only. No phone bezel, notch, OS status, browser chrome, home indicator, rounded device mask, outer canvas, device shadows, multi-screen collage or marketing title. Full bleed app surface.
Attached images are STYLE references only, historical captures of this actual app. Use their restrained editorial typography, warm cream background, forest green text and rounded controls, not their old content, obsolete stats, enormous sentence text or overflowing layout.
Exact existing color tokens: background #fbf8f0, paper #fffdf8, primary ink #0b4a3a, secondary ink #29594c, burnt orange #d66f3f, muted #737a76, divider #ddd9cf. Body text around 15px; Chinese headings 26-32px maximum, English practice text around 25px. Two fonts max, clean Chinese sans with readable English. Use spacing and fine dividers first; no nested cards, no excessive panels, gradients, decorations, badges or invented scores. Tiny consistent outlined icons. Generous but functional whitespace.
The user learns both common daily English and overseas trade. The scene shown is a hypothetical Chinese supplier communicating with an overseas customer about sending samples; all delivery promises are clearly examples. Maintain just one main CTA and up to two supporting actions. Buttons 48px or taller, content must not overlap bottom action, bottom padding at least 24px. No fake numeric AI pronunciation score, no confetti, avatar illustration, decorative photo or waveforms when not recording. Clear legible simplified Chinese copy. Include a small quiet top caption "界面提案" to distinguish concept.
Direction name: 提纲表达. Outcome-first briefing and speaking, the core "自己说" phase shown before recording starts.
Top slim navigation row with back chevron, "场景口语", small "界面提案".
Thin progress row "听懂   /   跟读   /   自己说" with the last stage active. Subtle top label "寄样与确认交期".
Main headline "现在，换你来说" in large 30px forest-green Chinese. Smaller description "把你想告诉客户的事，连起来说。".
The core surface is a generously spaced editorial numbered outline under small orange label "这次说清 3 件事":
"01  确认样品与数量"
"02  说明付款后寄出"
"03  提醒提供收件信息"
These are three rows separated by fine hairlines, not rounded cards. Below a quiet note "30–60 秒即可，不必逐字背诵。".
A single light mint horizontal strip lower down reads "英文参考已收起", followed by small text link "卡住了？看一句提示".
Bottom area with a subtle small mic icon and caption "准备好再开始"; one wide forest-green CTA "开始录音"; below secondary action "不方便录音，直接练习".
Small 12px line at very bottom "本次录音仅供回听，不上传".
Do not display English model answers in this frame, no artificial timer already running, no score or "掌握" button. Maintain calm disciplined spacing and large thumb-friendly actions without wasted oversized headings.
```

## 情景对话

```text
Create realistic, production-quality UI designs with clear hierarchy, strong typography, and purposeful spacing.
Use case: ui-mockup. This is a design proposal for Phrase Bank, an existing Chinese learner's English web app. One independent mobile screen concept, not implemented. Current date anchor: 2026-09-29, do not display a calendar or dates. Target viewport 390 x 844, render at 2x (780 x 1688) if needed preserving exact aspect ratio. Mobile app content only. No phone bezel, notch, OS status, browser chrome, home indicator, rounded device mask, outer canvas, device shadows, multi-screen collage or marketing title. Full bleed app surface.
Attached images are STYLE references only, historical captures of this actual app. Use their restrained editorial typography, warm cream background, forest green text and rounded controls, not their old content, obsolete stats, enormous sentence text or overflowing layout.
Exact existing color tokens: background #fbf8f0, paper #fffdf8, primary ink #0b4a3a, secondary ink #29594c, burnt orange #d66f3f, muted #737a76, divider #ddd9cf. Body text around 15px; Chinese headings 26-32px maximum, English practice text around 25px. Two fonts max, clean Chinese sans with readable English. Use spacing and fine dividers first; no nested cards, no excessive panels, gradients, decorations, badges or invented scores. Tiny consistent outlined icons. Generous but functional whitespace.
The user learns both common daily English and overseas trade. The scene shown is a hypothetical Chinese supplier communicating with an overseas customer about sending samples; all delivery promises are clearly examples. Maintain just one main CTA and up to two supporting actions. Buttons 48px or taller, content must not overlap bottom action, bottom padding at least 24px. No fake numeric AI pronunciation score, no confetti, avatar illustration, decorative photo or waveforms when not recording. Clear legible simplified Chinese copy. Include a small quiet top caption "界面提案" to distinguish concept.
Direction name: 情景对话. Dialogue-led speaking practice with scripted counterpart, not live AI. Show one prompt from an overseas buyer and the user's pending spoken reply.
Top row back chevron, "场景口语", tiny "界面提案". Scene title "寄样与确认交期" below.
Small spaced label "情景练习 · 第 2 / 3 轮".
Conversation composition: left small uppercase eyebrow "海外客户" with tiny understated letter avatar "B", followed by a broad light mint speech panel with readable English:
"When can you send
the samples?"
Below Chinese translation in smaller muted text "你们什么时候能寄出样品？", and a tiny speaker icon with "听客户的问题". This is the only conversation bubble on screen.
Below, offset slightly right but comfortably wide, use typography and whitespace for "轮到你回应" with a quiet role label "你 · 中国供应商".
Chinese instruction "告诉对方：收到样品费后安排寄出，并请他确认收件地址。". Three keyword hints in one line separated by middle dots "付款  ·  寄样  ·  收件信息".
A thin hairline then a discreet secondary link "需要帮助？展开参考表达".
At the bottom on cream background, a microphone icon beside "用自己的话回答，30 秒左右"; primary wide green button "录下我的回答"; secondary action "不录音，直接说".
Small understated footer note "客户台词为预设内容". This is a fixed dialogue exercise, no online AI indicator, no customer photo, no chat input field, no send-to-real-customer implication. Balanced spacious content, no bottom nav during session, controls fully in viewport.
```
