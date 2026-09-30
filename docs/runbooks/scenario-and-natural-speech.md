# 场景口语与自然发音

## 当前实现

- 首页「场景口语」：8 个日常场景、4 个中国供货方视角的外贸场景，每个 3 轮预设对话。
- 每轮可听问题、录音回听、展开参考、重新挑战或不录音直接练。使用英文提示后禁止把该尝试评为独立完成。
- 独立场景记录：SQLite `scenario_documents` + 账号隔离的本机草稿，8 秒请求上限、版本冲突保护、重复请求幂等。与原来的 SRS 数据分表，不更改每日答对或三日掌握。
- 最多保留 30 次场景会话和 20 个进行中会话；仅裁剪已完成的最旧记录。可以手选本场景的重点表达，下次在场景列表提示。
- 场景记录可单独导出；尚未接入原句库 JSON 的导入恢复。最近完成的练习可回看确认文字与建议。仅手动确认加入复习时改变排期。
- 音频为临时录音，离开本轮或刷新后释放，不跨设备保存；只有点击「上传录音并转写」才发送给 Qwen。

## 已学关联与表达教练（2026-09-29 补充）

流程：优先推荐含已学表达的场景 → 自己回答 → 可选上传转写 / 手动填实际回答 → 核对文字 → 主动获取 AI 建议 → 按建议再说一次 → 将确认练过的难句加入日常复习。

- 用具体沟通意图规则匹配已学/已掌握、未退役的句子；锁定的系统案例不算已学。每轮最多推荐 2 条，场景按关联条数排序。匹配是推荐，不保证穷尽语义相近的句子，也不动态生成客户台词；无匹配时明确标为通用练习。
- Qwen ASR `qwen3-asr-flash`：前端在用户点击后将浏览器音频转换为单声道 16kHz PCM16 WAV，服务端校验格式和长度（约 91 秒容错、2,912,044 字节上限），再转 base64 调用兼容 API。转写不发送参考答案，防止识别被答案诱导。无法解码时提示手填，不阻断自评。
- Qwen 文本反馈：默认 `qwen-plus`，非思考 JSON 模式。只分析确认文字，说明是否回应问题、优点、最多 2 个改进、保留原意的自然说法和下次重点；不打发音分、不从转写判断口音/语速。第二次带上同轮最近一次确认文字，可返回文字变化对比。
- 看反馈视作提示，当前尝试不能记独立完成；「按建议再说一次」创建新尝试，保留旧文字和建议。每场会话 18 次尝试后不再提供重试（最后推进可能再产生 2 次正常轮次）；完成后可新开一场。
- 录音不入数据库、不入日志；转写/反馈请求经过认证、同源检查、正文大小限制和超时。原音频会送给 Qwen 处理，供应商留存遵循其服务约定，不能承诺供应商零留存。
- 确认文字与反馈进入账号隔离的 `scenario_documents`。文本结果短期缓存 `scenario_ai_cache` 每账号最多 100 条，有效期 7 天，读取缓存时清理过期数据；数据库备份也包含这些文本。未确认转写可存在此短期缓存中，但不会自动计入场景尝试。
- 每账号每天（UTC）最多 40 次转写、60 次反馈；失败请求占一次额度，命中缓存不占。相同进行中请求合并，不同请求每种类型每账号同时最多 1 个。额度是调用数限制，不是货币预算。
- 等待时可取消或直接自评继续；离开本轮会取消本机请求并忽略迟到结果。已到服务器的请求可能继续完成并计费/缓存，不自动连续重试。
- 加入复习前要求主动勾选「我已理解并开口练过这句」。同文已有句子提前到待复习，保留等级、历史与原文；新表达进入「场景练习」个人句库，标为已接触可复习，但不记新句测试/答对次数或掌握天数。不绕过锁定系统案例的解锁规则。
- 加入复习是一次原子本地操作，云端沿用版本冲突保护、失败回滚和安全重试。旧场景客户端不能无声删掉新增转写/反馈字段。

与自然发音共用服务端 Key。`PHRASE_SCENARIO_AI_ENABLED=false` 可独立关闭转写/反馈；测试和 CI 必须同时关闭此开关与 `PHRASE_TTS_ENABLED`。模型可通过 `PHRASE_SCENARIO_FEEDBACK_MODEL` 配置，需支持非思考 JSON 输出。

## 统一发音

此前各浏览器选择第一个匹配英语口音的系统声音，设备差异会直接影响听感。现在默认美式使用 Qwen `qwen3-tts-flash` 的 `Jennifer`，指定语言 English，音频经同源接口传给浏览器。英式仍使用设备声音；本机选择优先 premium/enhanced/natural，避免优先 compact。

设置中可切换自然美式 / 设备语音并试听。云端不可用自动使用设备语音，页面会提示；Safari 如果拦截首次异步播放，会保留已生成的音频，并提示再点一次，不重复生成。

自然发音服务只发送用户要求朗读的文字，与上面的录音转写是两个独立动作。密钥仅在服务端读取；音频缓存按账号隔离，客户端不接收供应商密钥或签名下载地址。每账号每天最多生成 100 条新音频（UTC），缓存命中不占额度。并发相同句子复用一个生成请求；失败请求也占一次额度以防无限重试。

生产默认复用已有的 `/etc/phrase-bank/qwen-content.env`；可在 `/etc/phrase-bank/speech.env` 覆盖运行期配置（参考仓库 `.env.speech.example`），权限保持 600。Compose 按此顺序读取两个可选 env_file，不复制密钥到项目目录；都缺失时自动回退设备声音，AI 反馈提示未配置。部署后只读检查运行期开关、配置和 Qwen 认证，不输出密钥、不生成付费内容。不要把实际密钥提交到仓库或输出日志。生产配置使用百炼北京或新加坡地域与匹配的 Key。

Compose 将现有站点域名列入 `VINEXT_TRUSTED_HOSTS`，让 Caddy 转发的 HTTPS 协议信息用于同源校验；应用端口仍不向公网发布。更换域名时需同步调整这一白名单。音频缓存每账号最多 1500 条、128 MiB，超出时淘汰较早记录；退出账号释放本机内存里的音频。

本机开发模式可读取已存在的 `%USERPROFILE%/.phrase-bank/qwen-content.env`。正式构建本地验证需显式将 `PHRASE_TTS_ENV_FILE` 指向该文件。`PHRASE_TTS_ENABLED=false` 可关闭云端发音；测试和 CI 必须关闭，以避免调用付费 API。

## 接口

- `GET /api/scenarios` / `PUT /api/scenarios`：需要账号会话；PUT 携带 progress、revision、operationId，冲突返回 409。
- `GET /api/speech`：只返回是否已配置等非秘密状态。
- `POST /api/speech`：需要账号会话，接受最多 600 字符的 text 与 `accent: en-US`，返回 WAV；无法使用时客户端回退设备语音。
- `POST /api/scenarios/transcribe`：认证后的规范 WAV 上传，返回待确认 transcript；不自动生成反馈。
- `POST /api/scenarios/feedback`：scenarioId、turn、确认后的 transcript，以及可选 previousTranscript；服务端使用可信场景任务，返回校验后的文字建议。
- 语音与场景记录均在现有 SQLite 卷中，数据库备份包含这些表；旧的句库导入不会清除场景记录。

## 验证边界

开发需分别验证真实浏览器的完整 3 轮流程、提示/重试、暂停恢复和小屏布局。录音许可、来电/锁屏中断和设备听感需要真机 iPhone Safari 检查，移动 WebKit 自动化不能替代这项确认。

API 合同依据：[Qwen TTS HTTP API](https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api) 与 [官方音色列表](https://help.aliyun.com/en/model-studio/qwen-tts-voice-list)，查阅日期 2026-09-29。

转写与反馈合同：[Qwen ASR API](https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference)、[Qwen 结构化输出](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-structured-output)。音频转换依据 [MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)。Windows 自动化 WebKit 没有 OfflineAudioContext，此环境验证手动填写降级；不能据此声称验证了 iPhone 的音频解码。

可选真实接口冒烟脚本 `scripts/verify-scenario-ai.ts` 只允许本地地址、隔离测试账号、明确 `PHRASE_VERIFY_PAID_AI=true`；通过环境变量提供 `PHRASE_VERIFY_USERNAME` / `PHRASE_VERIFY_PASSWORD`，不使用真实用户音频。会产生少量 TTS、ASR、反馈费用；不得默认放入 CI。先前验证使用合成的公开日常句，不代表真实录音识别率。
