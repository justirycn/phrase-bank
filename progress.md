# 部署进度

## 2026-08-08

- 已将源码推送到 `justirycn/phrase-bank`。
- 已通过 SSH 登录腾讯云并完成只读环境检查。
- 用户选择 GitHub Actions 自动部署方案，无域名，首版使用公网 IP。
- 已确认部署设计并提交规格文档。
- 已创建持久化任务计划、发现记录与进度日志。
- 已完成详细实施计划和自检。
- 当前：测试驱动创建 Docker、Compose 与 GitHub Actions 配置；尚未修改服务器软件环境。
- 已生成 GitHub Actions 专用 SSH 密钥，公钥已安装到服务器并验证无密码登录。
- 发现远程工作流不能交互输入 sudo 密码，已调整方案为将 `ubuntu` 加入 `docker` 组并移除工作流中的 `sudo docker`。
- 首次重新复制部署私钥时 Windows 剪贴板被占用，`Set-Clipboard` 失败；改用 `clip.exe`，不在聊天或工具输出中显示私钥。
- 已从 Docker 官方 apt 仓库安装 Docker Engine 29.7.2 与 Compose 5.4.0，服务处于 active。
- 已将 `ubuntu` 加入 docker 组，新 SSH 会话可直接运行 Docker。
- 已创建 Dockerfile、Compose 与 GitHub Actions 工作流，部署契约和完整测试共 23 项通过，生产构建通过。
- 用户已在 GitHub 配置 `TENCENT_HOST`、`TENCENT_USER`、`TENCENT_SSH_KEY`。
- 当前：提交并推送部署配置以触发首次自动部署。
