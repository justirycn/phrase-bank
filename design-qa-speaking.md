# Phrase Bank 口语训练移动端验收

## 验收环境

- 视口：390 × 844（iPhone 13 Pro CSS 视口）
- 页面：http://localhost:3000/
- 日期：2026-08-09
- 浏览器：Codex 内置 Chromium；另用已连接 Chrome 复查麦克风权限入口
- 数据：本机 IndexedDB；录音 Blob 未写入持久化数据

内置浏览器的 DOM 实测为 390 × 844；其中 5 张直接交互截图由截图后端裁去浏览器滚动条与外框后导出为 375 × 812。3 张确定性组件状态截图保持 390 × 844。两组尺寸都在自动测试中锁定。

## 截图证据

1. `docs/audits/iphone13pro-speaking/01-home-0-of-30.png` — 首页 0 / 30 分钟
2. `docs/audits/iphone13pro-speaking/02-prompt.png` — 中文提示、英文隐藏
3. `docs/audits/iphone13pro-speaking/03-active-recording.png` — 录音中状态
4. `docs/audits/iphone13pro-speaking/04-answer-recording-playback.png` — 英文答案与本次录音回放
5. `docs/audits/iphone13pro-speaking/05-hint-answer-disabled-mastery.png` — 使用发音提示后“掌握”禁用
6. `docs/audits/iphone13pro-speaking/06-group-complete.png` — 小组完成
7. `docs/audits/iphone13pro-speaking/07-speech-settings.png` — 自动朗读与英美音设置
8. `docs/audits/iphone13pro-speaking/08-microphone-denied-fallback.png` — 麦克风拒绝后的跳过录音入口

录音中、回放和拒绝权限三种视觉状态使用最终 `SpeakingPractice` 组件与最终 CSS 在临时本地验收页渲染；临时验收页已删除。真实应用流程、录音生命周期、权限失败、自评和资源释放另由组件、Hook 与服务测试覆盖。

## 交互与布局检查

- 首页可启动标准组和快速组，显示分钟、完成组数、连续天数与周度重点。
- 提示阶段只显示中文；答案阶段显示英文、个人例句、标准发音、录音回放和三档评价。
- 长按录音按钮保持同一 DOM 节点；松开、取消或键盘释放均只停止一次。
- 麦克风不可用时显示授权说明和“跳过录音，继续自评”。
- 发音提示后“掌握”不可用；自动发音卡住时不阻塞评分，切换下一题前会取消旧发音。
- “不会”每组最多追加一次回炉项；真实浏览器完成页可正常到达。
- 设置页不会请求麦克风；偏好加载与保存按顺序执行，失败时回退到最后成功值。
- 页面 `scrollWidth` 不超过视口宽度；长中英文正常换行，无横向滚动。
- 普通按钮高度至少 44px，录音按钮 64px；答案操作区和权限失败操作区均预留安全区空间。
- `prefers-reduced-motion` 下录音脉冲动画关闭。
- 最终新标签页的应用来源控制台 error / warning：0。

## 验收中发现并修复

- P1：回炉项再次选择“不会”会无限追加。已限制为每个语言块每组最多回炉一次。
- P1：浏览器语音回调不返回时会锁住评分。自动朗读已改为非阻塞，并在进入下一题前取消旧语音。
- P1：完成与评分、自动保存之间的竞态可能复活已完成会话。已串行化并加入回归测试。
- P2：语音设置读取与多次保存可能乱序。已加入加载保护和串行保存。

当前无未解决的 P0、P1 或 P2 问题。

final result: passed
