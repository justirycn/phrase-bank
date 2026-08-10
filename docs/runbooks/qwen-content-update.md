# Qwen 系统句库更新指南

这套流程只在你主动运行时调用 Qwen，不会每天自动扣费。生成、独立审校和本地质量门全部通过后，才允许替换系统句库。

## 开始前

1. 先在阿里云百炼控制台把曾经发到聊天中的旧 Key **作废**。
2. 创建一个新的 Key。不要把新 Key 发到聊天、微信、GitHub 或截图中。
3. 确认 Key 所在地域及工作空间对应的 OpenAI 兼容地址。不同地域的 Key 与地址不能混用；不确定时在百炼控制台查看工作空间调用信息。

## 在腾讯云服务器保存新 Key

通过腾讯云网页终端登录服务器，然后打开一个只允许管理员读取的配置文件：

```bash
sudo install -m 600 /dev/null /etc/phrase-bank/qwen-content.env
sudo nano /etc/phrase-bank/qwen-content.env
```

在编辑器中填写下面三行，再保存退出：

```text
DASHSCOPE_API_KEY=这里粘贴新Key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

如果百炼控制台给出带工作空间 ID 的专属地址，应使用控制台地址替换第二行。再次限制文件权限：

```bash
sudo chmod 600 /etc/phrase-bank/qwen-content.env
```

不要运行会把 Key 直接写在命令行里的 `export DASHSCOPE_API_KEY=...`，避免进入终端历史。

## 生成并自动质检

进入服务器上的 Phrase Bank 项目目录，先确认代码是最新版本。以下示例把版本写成 `2026.08.2`；以后每次必须使用新的版本号。

```bash
git pull --ff-only github main
docker run --rm \
  --env-file /etc/phrase-bank/qwen-content.env \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:22-bookworm-slim \
  sh -lc 'npm ci && npm run content:qwen -- --version 2026.08.2'
```

Agent 将 600 个核心拆成最多 20 个核心的小批次，预计执行 31 次生成和 31 次独立审校，共 62 个逻辑请求。网络限流时每个请求最多尝试 3 次，因此硬上限是 186 次 HTTP 尝试。任何一批失败都会停止，且不会改变线上句库。

成功后会生成：

- `.content-agent/candidate-2026.08.2.json`
- `.content-agent/report-2026.08.2.json`

报告必须显示 `status: pass`、`coreCount: 600`、`totalCount: 2000`、`errors: []`。

## 发布候选版本

只有报告通过时才执行：

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:22-bookworm-slim \
  sh -lc 'npm ci && npm run content:publish -- --version 2026.08.2'
```

发布命令会再次验证内容，新增版本化 JSON，并更新网页使用的版本号；旧版本不会被删除。随后运行完整检查：

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim sh -lc 'npm ci && npm test && npm run lint && npm run build'
```

检查通过后，只提交新版本 JSON、版本引用和必要代码，不提交 `.content-agent` 或 `/etc/phrase-bank/qwen-content.env`。推送 `main` 后等待 GitHub Actions 部署成功，再打开网页确认“系统句库”已安装新版本。

## 失败与回滚

- 认证失败：确认新 Key、地域和 `DASHSCOPE_BASE_URL` 是否匹配。
- 限流或超时：保留旧版本，稍后重新运行相同候选版本；不要手工拼接半成品。
- 质检失败：查看不含 Key 的报告摘要，修正提示词或重新生成；禁止运行 `content:publish`。
- 部署后安装失败：网页继续使用旧版本，不会删除个人句子或学习记录。
- 需要回滚：把 `app/domain/bundledSystemContent.ts` 恢复为上一版本，提交并重新部署。旧 JSON 与 IndexedDB 包仍被保留。

最后可以删除本次临时候选：

```bash
rm -f .content-agent/candidate-2026.08.2.json .content-agent/report-2026.08.2.json
```
