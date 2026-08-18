# Qwen 系统句库本地更新指南

推荐且默认的操作方式是在自己的 Windows 电脑上恢复断点、完成 Qwen 生成，并在只监听本机的页面中审核。只有明确批准后，才从干净的独立 worktree 发布。此流程不会定时调用 Qwen，也不会自动发布。

本文命令以版本 `2026.08.3` 为例。开始新版本时，应在所有命令中使用同一个新版本号。

## 开始前：把 Key 放在项目外

先在阿里云百炼控制台把曾经发到聊天中的旧 Key **作废**，再创建新 Key。新 Key 只能保存在项目外的 `%USERPROFILE%\.phrase-bank\qwen-content.env`；不要把 Key 粘贴到聊天、微信、Issue 或截图，不要在终端中粘贴或输出 Key，也不得提交到仓库。

用记事本创建配置。只在记事本中粘贴真实 Key：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.phrase-bank" | Out-Null
notepad "$env:USERPROFILE\.phrase-bank\qwen-content.env"
```

文件必须恰好包含以下三个配置项，不要增加其他变量：

```text
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen-plus
```

如果百炼控制台提供带工作空间 ID 的专属地址，应使用控制台地址。地域、工作空间、Key 与地址必须匹配。程序会拒绝仓库内的配置文件、符号链接、重复项、缺项和未知配置项；日志不会打印 Key。

## 推荐流程：恢复断点并在本地审核

### 1. 手动导出一个检查点

在仓库根目录运行以下 PowerShell 命令。GitHub Actions 中的工作流名称是 **Export Qwen checkpoint**；它只读取一个检查点，不读取 Qwen Key，产物只保留一天。

```powershell
gh workflow run qwen-checkpoint-export.yml -f version=2026.08.3
$runId = gh run list --workflow qwen-checkpoint-export.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --exit-status
gh run download $runId -n qwen-checkpoint-2026.08.3 -D .content-agent/download
npm run content:checkpoint:import -- --version 2026.08.3 --source .content-agent/download/qwen-checkpoint.json
```

导入会验证版本、稳定 ID、不可变元数据和源内容指纹，然后原子写入 `.content-agent/checkpoint-2026.08.3.json`。当前预期断点有 **1,220** 条短语，对应逻辑进度 **68 / 120**；实际进度始终由程序根据稳定 ID 重新计算，不信任文档中的数字。

检查点可以续跑。生成中断、限流或电脑重启后，保留 `.content-agent/checkpoint-2026.08.3.json` 并再次运行同一版本即可；程序会从已验证的批次继续，不会重复已完成的付费批次。不要删除检查点后盲目重跑，也不要手工拼接检查点。

### 2. 本地继续生成

下面的命令会产生 Qwen API 费用。应在确认检查点导入成功并获得明确许可后运行：

```powershell
npm run content:qwen:local -- --version 2026.08.3
```

成功时会写入以下忽略文件，仍不会改动线上内容：

- `.content-agent/candidate-2026.08.3.json`
- `.content-agent/report-2026.08.3.json`

### 3. 在 localhost 页面审核

```powershell
npm run content:review -- --version 2026.08.3
```

浏览器只访问 `http://127.0.0.1:43127`。服务只监听 `127.0.0.1`，不会暴露到局域网。候选英文和中文是只读的；只能编辑抽样条目的审核决定与备注。

每个抽样条目都必须标记为“通过”才能批准。任何“有问题”都会阻止批准；修复内容必须重新生成候选，并针对新的内容哈希重新审核。页面批准只写入 `.content-agent/review-2026.08.3.json`；**页面批准不会直接提交**、推送或部署。

### 4. 明确批准后发布

关闭审核页面后，从一个完全干净、与最新 `origin/main` 一致的独立 Git worktree 运行：

```powershell
npm run content:release:approved -- --version 2026.08.3
```

发布命令会重新核对候选哈希、审核状态、分支位置和全部质量门。它只提交以下两个文件，而且只创建一个内容提交：

- `public/content/system-content-2026.08.3.json`
- `app/domain/bundledSystemContent.ts`

命令使用非强制推送，并确认远端 `main` 精确指向该提交。随后它明确运行 `deploy.yml`，把同一个 40 位提交 SHA 作为 `approved_sha` 传入；部署工作流拒绝 SHA 不一致的事件，并在服务器检出该精确提交，而不是稍后的 `main`。

## 失败、重试与回滚

- 检查点导出失败：不要转而下载整个 `.content-agent` 目录，更不能复制 `/etc/phrase-bank/qwen-content.env`。检查版本号、服务器文件是否存在和 SSH 连接后，只重试单文件导出。
- 导入被拒绝：不要绕过验证或从零开始付费生成。确认下载的是同版本检查点，并确认本地代码与检查点来源一致；保留原文件用于排查。
- 认证失败：只在本机记事本中检查新 Key、地域和 `DASHSCOPE_BASE_URL`。绝不要把配置内容粘贴到命令行、聊天或日志。
- 限流、超时或生成中断：保留检查点，稍后用相同版本重试 `content:qwen:local`。续跑会跳过已完成批次，避免重复花费。
- 自动质检失败：查看不含 Key 的报告摘要；不要运行 `content:release:approved`。修正生成逻辑后续跑或重新生成，并完成新哈希的审核。
- 审核发现问题：保留备注，但不要手工修改只读候选。修复来源或生成逻辑、生成新候选并重新审核。
- 发布前检查失败：命令不会推送。修复工作树、测试或 `origin/main` 漂移问题后重新执行；不要使用强制推送。
- 推送成功但部署派发失败：不要再次生成或创建第二个内容提交。查出已经推送的精确 SHA，再以 `approved_sha=<该 SHA>` 单独派发 `deploy.yml`。
- 部署后安装失败：网页继续使用旧版本，不会删除个人句子或学习记录。需要回滚时，把 `app/domain/bundledSystemContent.ts` 恢复为上一版本，提交后用该回滚提交的精确 SHA 重新部署；旧 JSON 与 IndexedDB 包仍保留。

## 服务器工作流：仅限灾难恢复

`.github/workflows/qwen-content-release.yml` 是手动 `workflow_dispatch` 工作流，**仅用于灾难恢复**；不要用于本地审核流程，任何本地命令也不会派发它。日常流程不得从 Actions 运行 **Generate and deploy Qwen content**，因为它会在服务器生成并直接走发布路径，绕过本地页面审核。

只有本地环境无法恢复、操作负责人明确批准灾难恢复时，才可使用服务器配置 `/etc/phrase-bank/qwen-content.env`。该文件由执行 SSH 的用户拥有并保持权限 `600`：

```bash
SSH_USER="$(id -un)"
SSH_GROUP="$(id -gn)"
sudo chown "$SSH_USER:$SSH_GROUP" /etc/phrase-bank/qwen-content.env
sudo chmod 600 /etc/phrase-bank/qwen-content.env
```

恢复时仍须先运行 `content:qwen` 生成和检查候选，再由恢复工作流运行 `content:publish`、全部测试、lint、构建与差异检查。不得把服务器配置下载到本地，不得打印或记录 Key，不得使用强制推送。恢复完成后应确认它明确触发 `deploy.yml`，且 `approved_sha` 等于刚创建的内容提交 SHA。
