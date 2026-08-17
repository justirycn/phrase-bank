# Qwen 系统句库更新指南

这套流程只在你主动运行时调用 Qwen，不会每天自动扣费。生成、独立审校和确定性的质量门全部通过后，才允许替换系统句库。

## 推荐：一键运行 GitHub Actions

日常更新请优先使用 GitHub 的一键流程：进入仓库的 **Actions**，选择 **Generate and deploy Qwen content**，点击 **Run workflow**。当前自动流程固定发布版本 `2026.08.3`；需要下一个版本时，先在仓库中更新该工作流的版本号，再运行它。

Qwen 的 Key 只保存在腾讯云服务器的 `/etc/phrase-bank/qwen-content.env`，由运行 SSH 的同一用户拥有，权限必须是 `600`。GitHub Actions 只使用服务器连接所需的 `TENCENT_HOST`、`TENCENT_SSH_KEY` 和 `TENCENT_USER`，不会读取、输出或复制 Qwen Key。

当前 SSH 设置会使用 `ssh-keyscan` 获取主机指纹；这属于首次信任（TOFU），并不是带外验证的主机密钥固定。`StrictHostKeyChecking=yes` 会校验本次取得的 `known_hosts`，但首次指纹仍应通过腾讯云控制台或其他可信渠道核对。

工作流会在服务器生成候选内容并进行独立审校，再把候选与审校报告取回，在 GitHub 上执行发布、聚焦测试、完整测试、lint、构建和 Git 差异检查。任一生成、审校或质量门失败都会停止，绝不会发布新句库或创建提交。

成功后，工作流只提交版本化句库和版本引用到 `main`，随后明确触发 `Test and deploy` 工作流部署。不要依赖机器人 `GITHUB_TOKEN` 推送自动触发 `push` 工作流。可在 Actions 页面依次查看 Qwen 生成任务和随后明确触发的部署任务；两者都成功后，再打开网页确认“系统句库”已安装新版本。

以下保留的手动步骤仅用于恢复或排查自动流程，而不是日常发布方式。

## 开始前

1. 先在阿里云百炼控制台把曾经发到聊天中的旧 Key **作废**。
2. 创建一个新的 Key。不要把新 Key 发到聊天、微信、GitHub 或截图中。
3. 确认 Key 所在地域及工作空间对应的 OpenAI 兼容地址。不同地域的 Key 与地址不能混用；不确定时在百炼控制台查看工作空间调用信息。

## 在腾讯云服务器保存新 Key

通过腾讯云网页终端登录服务器，然后打开一个只允许管理员读取的配置文件：

```bash
SSH_USER="$(id -un)"
SSH_GROUP="$(id -gn)"
sudo install -o "$SSH_USER" -g "$SSH_GROUP" -m 600 /dev/null /etc/phrase-bank/qwen-content.env
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
sudo chown "$SSH_USER:$SSH_GROUP" /etc/phrase-bank/qwen-content.env
sudo chmod 600 /etc/phrase-bank/qwen-content.env
```

不要运行会把 Key 直接写在命令行里的 `export DASHSCOPE_API_KEY=...`，避免进入终端历史。

## 生成并自动质检

进入服务器上的 Phrase Bank 项目目录，先确认代码是最新版本。以下示例把版本写成 `2026.08.3`；以后每次必须使用新的版本号。

```bash
git pull --ff-only origin main
docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:22-bookworm-slim \
  sh -lc 'npm ci'
docker run --rm \
  --env-file /etc/phrase-bank/qwen-content.env \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:22-bookworm-slim \
  sh -lc 'npm run content:qwen -- --version 2026.08.3'
```

Agent 将 600 个核心拆成最多 10 个核心的小批次，预计执行 60 次生成和 60 次独立审校，共 120 个逻辑请求，并持续显示进度。网络限流时每个请求最多尝试 3 次，因此硬上限是 360 次 HTTP 尝试。任何一批失败都会停止，且不会改变线上句库。

成功后会生成：

- `.content-agent/candidate-2026.08.3.json`
- `.content-agent/report-2026.08.3.json`

报告必须显示 `status: pass`、`coreCount: 600`、`totalCount: 2000`、`errors: []`。

## 发布候选版本

只有报告通过时才执行：

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:22-bookworm-slim \
  sh -lc 'npm ci && npm run content:publish -- --version 2026.08.3'
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
rm -f .content-agent/candidate-2026.08.3.json .content-agent/report-2026.08.3.json
```
