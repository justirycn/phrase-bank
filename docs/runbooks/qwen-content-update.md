# Qwen 系统句库本地更新指南

推荐且默认的操作方式是在自己的 Windows 电脑上创建一个干净的独立 worktree，在其中恢复断点、继续 Qwen 生成、完成本机审核，并在明确批准后发布。检查点、候选、报告和审核状态始终留在同一个 worktree 的 `.content-agent` 中。此流程不会定时调用 Qwen，也不会自动发布。

本文命令以版本 `2026.08.3` 为例。开始新版本时，应在所有命令中使用同一个新版本号。下面所有命令要求 **PowerShell 7.3 或更高版本**，并且必须在同一个终端会话中依次执行。每个可执行代码块都先启用 PowerShell 与原生命令的 fail-fast；`git`、`gh` 或 `npm` 返回非零状态时必须立即停止。

## 开始前：把 Key 放在项目外

先在阿里云百炼控制台把曾经发到聊天中的旧 Key **作废**，再创建新 Key。新 Key 只能保存在项目外的 `%USERPROFILE%\.phrase-bank\qwen-content.env`；不要把 Key 粘贴到聊天、微信、Issue 或截图，不要在终端中粘贴或输出 Key，也不得提交到仓库。

用记事本创建配置。只在记事本中粘贴真实 Key：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
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

## SSH 主机密钥：先核验，再固定

当前 GitHub Actions 使用 `ssh-keyscan` 动态取得腾讯云主机密钥。这只是首次信任（TOFU）：`StrictHostKeyChecking=yes` 只会检查本次刚取得的值，不能阻止首次连接时的中间人攻击。

在派发任何工作流前，管理员必须通过与 SSH 网络路径不同的可信渠道（例如腾讯云控制台的 VNC/网页终端）在服务器上读取真实主机公钥指纹；不要猜测或在本文填写指纹。然后在 PowerShell 7.3 中扫描公开主机密钥并逐字比较：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$hostName = Read-Host "腾讯云主机名或 IP"
$expectedFingerprint = Read-Host "粘贴从可信控制台取得的完整指纹"
$scanPath = $null
try {
  $scanPath = (New-TemporaryFile).FullName
  ssh-keyscan -t ed25519 $hostName | Set-Content -Encoding ascii $scanPath
  $scannedKeyLines = @(Get-Content -LiteralPath $scanPath | Where-Object {
    $_ -and -not $_.StartsWith("#")
  })
  $matchedKeyLines = @()
  foreach ($keyLine in $scannedKeyLines) {
    $candidatePath = $null
    try {
      $candidatePath = (New-TemporaryFile).FullName
      $keyLine | Set-Content -Encoding ascii $candidatePath
      $candidateFingerprintLine = ssh-keygen -lf $candidatePath
      $candidateFields = @($candidateFingerprintLine.Trim() -split '\s+')
      if ($candidateFields.Count -lt 2) { throw "无法解析扫描到的主机密钥指纹" }
      if ($candidateFields[1] -eq $expectedFingerprint) {
        $matchedKeyLines += $keyLine
      }
    }
    finally {
      if ($candidatePath -and (Test-Path -LiteralPath $candidatePath)) {
        Remove-Item -LiteralPath $candidatePath -Force
      }
    }
  }
  if ($matchedKeyLines.Count -ne 1) { throw "主机密钥必须恰好有一行匹配可信指纹；停止连接" }
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
  $matchedKeyLines[0] | Set-Content -Encoding ascii "$env:USERPROFILE\.ssh\phrase-bank-known_hosts"
}
finally {
  if ($scanPath -and (Test-Path -LiteralPath $scanPath)) {
    Remove-Item -LiteralPath $scanPath -Force
  }
}
```

只有逐字比较成功的完整主机密钥行才能固定到专用 `known_hosts` 文件。指纹变化时立即停止，回到腾讯云控制台核实轮换或安全事件。上述操作固定的是本机连接；当前 Actions 动态 `ssh-keyscan` 仍是 TOFU，不能把它描述成已固定。生产派发前应由基础设施负责人通过单独评审，把同一条已核验主机密钥固定到 Actions 的 `known_hosts` 来源；本文不虚构指纹、变量值或秘密。

## 推荐流程：同一个 worktree 完成恢复、审核和发布

### 1. 先创建精确基于 `origin/main` 的独立 worktree

从现有仓库根目录开始。先更新远端引用并记录精确 SHA，再创建 detached 的 linked worktree。唯一请求 ID 同时用于 worktree、工作流标题和 artifact，因此不会误取另一个人的导出任务。

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (git rev-parse --show-toplevel).Trim()
git fetch --no-tags origin main
$releaseSha = (git rev-parse origin/main).Trim()
$requestId = [guid]::NewGuid().ToString("N")
$worktreePath = Join-Path (Split-Path $repoRoot -Parent) "phrase-bank-qwen-$requestId"
git worktree add --detach $worktreePath $releaseSha
Set-Location $worktreePath
if ((git rev-parse HEAD).Trim() -ne $releaseSha) { throw "worktree HEAD 与记录的 origin/main SHA 不一致" }
if (git status --porcelain=v1 --untracked-files=all) { throw "新 worktree 不是干净状态" }
npm ci
```

如果 `origin/main` 在发布前变化，发布命令会停止。不要把 `.content-agent` 复制到另一个 worktree；应保留当前 worktree，确认如何与新的 `main` 协调后再继续。

### 2. 手动导出并严格关联一个检查点

GitHub Actions 中的工作流名称是 **Export Qwen checkpoint**。它只读取一个检查点，不读取 Qwen Key，artifact 只保留一天。`request_id` 只接受 32 位小写十六进制值。

以下命令派发带版本和唯一请求 ID 的任务，然后轮询最多约一分钟。选择条件必须同时匹配工作流名称、事件类型、精确 head SHA、版本和请求 ID；找不到或出现重复匹配都会停止，绝不退回“最新一条”任务。

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$expectedTitle = "Export Qwen checkpoint 2026.08.3 ($requestId)"
gh workflow run qwen-checkpoint-export.yml --ref main -f version=2026.08.3 -f request_id=$requestId
$runId = $null
for ($attempt = 1; $attempt -le 30 -and -not $runId; $attempt++) {
  $runs = gh run list --workflow qwen-checkpoint-export.yml --event workflow_dispatch --branch main --limit 100 --json databaseId,displayTitle,event,headSha,workflowName | ConvertFrom-Json
  $matches = @($runs | Where-Object {
    $_.displayTitle -eq $expectedTitle -and
    $_.headSha -eq $releaseSha -and
    $_.event -eq "workflow_dispatch" -and
    $_.workflowName -eq "Export Qwen checkpoint"
  })
  if ($matches.Count -gt 1) { throw "找到多个相同请求 ID 的导出任务；停止下载" }
  if ($matches.Count -eq 1) { $runId = $matches[0].databaseId } else { Start-Sleep -Seconds 2 }
}
if (-not $runId) { throw "未找到与工作流、head SHA、版本和请求 ID 完全匹配的导出任务" }
gh run watch $runId --exit-status
$verifiedRun = gh run view $runId --json databaseId,displayTitle,event,headSha,workflowName,conclusion | ConvertFrom-Json
if ($verifiedRun.databaseId -ne $runId -or
    $verifiedRun.displayTitle -ne $expectedTitle -or
    $verifiedRun.headSha -ne $releaseSha -or
    $verifiedRun.event -ne "workflow_dispatch" -or
    $verifiedRun.workflowName -ne "Export Qwen checkpoint" -or
    $verifiedRun.conclusion -ne "success") {
  throw "导出任务身份或结果与请求不一致；停止下载"
}
gh run download $runId -n qwen-checkpoint-2026.08.3-$requestId -D .content-agent/download
npm run content:checkpoint:import -- --version 2026.08.3 --source .content-agent/download/qwen-checkpoint.json
```

导入会验证版本、稳定 ID、不可变元数据和源内容指纹，然后原子写入当前 worktree 的 `.content-agent/checkpoint-2026.08.3.json`。当前预期断点有 **1,220** 条短语，对应逻辑进度 **68 / 120**；实际进度始终由程序根据稳定 ID 重新计算，不信任文档中的数字。

检查点兼容且内容未变化时可以续跑：程序只补齐缺失批次，不会重复已完成的付费批次。生成中断、限流或电脑重启后，回到同一个 worktree，用相同版本重试即可。不要删除、手工拼接或跨 worktree 搬运检查点。

### 3. 获得费用授权后在当前 worktree 继续生成

下面的命令会产生 Qwen API 费用。应在确认兼容检查点导入成功并获得明确许可后运行：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
npm run content:qwen:local -- --version 2026.08.3
```

成功时会在当前 worktree 写入以下忽略文件，仍不会改动线上内容：

- `.content-agent/checkpoint-2026.08.3.json`（完整的 2,000 条耐久检查点）
- `.content-agent/candidate-2026.08.3.json`
- `.content-agent/report-2026.08.3.json`

完整检查点会一直保留到第 6 步显式清理 worktree，不会在候选和报告写入后自动删除。候选或报告缺失、损坏时，用相同版本重新运行上述命令会从完整检查点重建文件，不会再次调用 Qwen；不要把它当作过期临时文件提前删除。

### 4. 在 localhost 页面审核并明确停止服务

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
npm run content:review -- --version 2026.08.3
```

浏览器只访问 `http://127.0.0.1:43127`。服务只监听 `127.0.0.1`，不会暴露到局域网。候选英文和中文是只读的；只能编辑抽样条目的审核决定与备注。

每个抽样条目都必须标记为“通过”才能批准。任何“有问题”都会阻止批准；修复内容必须重新生成候选，并针对新的内容哈希重新审核。页面批准只写入当前 worktree 的 `.content-agent/review-2026.08.3.json`；**页面批准不会直接提交**、推送或部署。

页面显示批准后，回到启动审核服务的终端按 `Ctrl+C`，并等待终端重新出现 PowerShell 提示符，确认监听器已经关闭。服务完全退出后才能运行发布命令。

### 5. 在同一个 worktree 发布

不要切换目录或另建 worktree。确认审核服务已经退出后，在保存上述全部 `.content-agent` 文件的当前 worktree 中运行：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
npm run content:release:approved -- --version 2026.08.3
```

发布命令会重新核对候选哈希、审核状态、分支位置和全部质量门。它只提交以下两个文件，而且只创建一个内容提交：

- `public/content/system-content-2026.08.3.json`
- `app/domain/bundledSystemContent.ts`

命令使用非强制推送，并确认远端 `main` 精确指向该提交。随后它明确运行 `deploy.yml`，把同一个 40 位提交 SHA 作为 `approved_sha` 传入；部署工作流拒绝 SHA 不一致的事件，并在服务器检出该精确提交，而不是稍后的 `main`。

## 精确部署失败后的恢复

发布命令的 push 会先产生一个 `deploy.yml` push-event 任务。显式派发失败或部署步骤失败时，优先重跑这个**精确任务 ID**的失败作业，不能选择“最新任务”。通用形式是 `gh run rerun <exact push-event RUN_ID> --failed`。以下命令用已批准提交的 40 位 SHA 精确筛选 workflow、event 和 head SHA，要求唯一匹配，然后重跑并监控同一个 ID：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$approvedSha = Read-Host "已批准并已推送的 40 位提交 SHA"
if ($approvedSha -notmatch '^[0-9a-f]{40}$') { throw "批准 SHA 格式无效" }
$pushRuns = gh run list --workflow deploy.yml --event push --commit $approvedSha --limit 100 --json databaseId,event,headSha,workflowName | ConvertFrom-Json
$matchingPushRuns = @($pushRuns | Where-Object {
  $_.event -eq "push" -and
  $_.headSha -eq $approvedSha -and
  $_.workflowName -eq "Test and deploy"
})
if ($matchingPushRuns.Count -ne 1) { throw "无法唯一确定精确 push-event 部署任务" }
$pushRunId = $matchingPushRuns[0].databaseId
gh run rerun $pushRunId --failed
gh run watch $pushRunId --exit-status
```

只有精确 push-event 任务无法恢复时才考虑手动派发。派发前必须重新 fetch，并证明 `origin/main` 仍然逐字等于已批准 SHA；不相等时禁止派发。派发后按返回的精确 manual run ID 监控，不要监控“最新任务”：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
git fetch --no-tags origin main
$originMainSha = (git rev-parse origin/main).Trim()
if ($originMainSha -ne $approvedSha) { throw "origin/main 已不再指向批准 SHA；禁止手动部署" }
$beforeManualIds = @(gh run list --workflow deploy.yml --event workflow_dispatch --commit $approvedSha --limit 100 --json databaseId | ConvertFrom-Json | ForEach-Object databaseId)
gh workflow run deploy.yml --ref main -f approved_sha=$approvedSha
$manualRunId = $null
for ($attempt = 1; $attempt -le 30 -and -not $manualRunId; $attempt++) {
  $manualRuns = gh run list --workflow deploy.yml --event workflow_dispatch --commit $approvedSha --limit 100 --json databaseId,event,headSha,workflowName | ConvertFrom-Json
  $newMatches = @($manualRuns | Where-Object {
    $_.databaseId -notin $beforeManualIds -and
    $_.event -eq "workflow_dispatch" -and
    $_.headSha -eq $approvedSha -and
    $_.workflowName -eq "Test and deploy"
  })
  if ($newMatches.Count -gt 1) { throw "发现多个候选手动部署任务；停止监控" }
  if ($newMatches.Count -eq 1) { $manualRunId = $newMatches[0].databaseId } else { Start-Sleep -Seconds 2 }
}
if (-not $manualRunId) { throw "未找到精确的手动部署任务" }
gh run watch $manualRunId --exit-status
```

### 6. 部署确认后的安全清理

先确认精确 SHA 的部署和网页健康检查成功。清理会删除该 worktree 内的 `.content-agent` 检查点、候选、报告和审核记录；如果需要保留审计材料，应先复制到仓库之外的受保护位置。然后回到原仓库并执行非强制删除：

```powershell
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
Set-Location $repoRoot
git worktree remove $worktreePath
```

不要添加 `--force`。如果 Git 拒绝清理，先检查 worktree 状态并处理意外文件或改动；不得通过强制删除绕过检查。

## 失败、重试与回滚

- 检查点任务未匹配：不要放宽 workflow、head SHA、版本或 request ID 条件，也不要选择最新一条运行。确认 `main` 是否在派发前变化；有变化时删除尚未使用的 worktree，重新从最新 `origin/main` 开始并生成新的 request ID。
- 检查点导出失败：不要转而下载整个 `.content-agent` 目录，更不能复制 `/etc/phrase-bank/qwen-content.env`。检查版本、服务器文件和 SSH 连接后，只重试带同一身份关联的单文件导出。
- 导入被拒绝：不得绕过验证。如果检查点与当前源内容兼容，保留它并续跑只补齐缺失批次；任何全新生成或不兼容检查点都会重新产生费用，必须重新获得明确的费用授权，并对新候选重新审核并批准。
- 认证失败：只在本机记事本中检查新 Key、地域和 `DASHSCOPE_BASE_URL`。绝不要把配置内容粘贴到命令行、聊天或日志。
- 限流、超时或生成中断：仅当验证确认是兼容检查点续跑时，才在同一个 worktree 用相同版本重试 `content:qwen:local`；它只补齐缺失批次。无法证明可续跑时，按全新付费生成处理，先重新获得明确的费用授权。
- 自动质检失败：查看不含 Key 的报告摘要；不要运行 `content:release:approved`。任何新候选哈希都必须重新审核并批准。
- 审核发现问题：保留备注，但不要手工修改只读候选。修复来源或生成逻辑、获得必要费用授权、生成新候选，再重新审核并批准。
- 发布前检查失败：命令不会推送。保留当前 worktree，修复测试或 `origin/main` 漂移问题；不要跨 worktree 复制 `.content-agent`，也不要使用强制推送。
- 推送或部署失败：严格执行上文“精确部署失败后的恢复”。优先重跑精确 push-event 任务：先按已批准 SHA 唯一确定 `$pushRunId`，再运行 `gh run rerun $pushRunId --failed` 并监控同一个 ID。只有该精确任务无法恢复时，才可使用文档中的 `origin/main` 精确 SHA 守卫和手动派发块；禁止通用或“最新任务”式手动派发。不要再次生成或创建第二个内容提交。同 SHA 的两个部署任务由服务器锁和健康检查幂等处理。
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
