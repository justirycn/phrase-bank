# Phrase Bank 腾讯云 GitHub Actions 部署设计

## 目标

将 Phrase Bank 源码托管在 `https://github.com/justirycn/phrase-bank`，并部署到 Ubuntu 22.04 腾讯云服务器 `43.153.204.17`。每次向 `main` 分支推送后，GitHub Actions 自动测试并部署。首版通过 `http://43.153.204.17` 访问，不配置域名和 HTTPS。

## 当前环境

- GitHub 仓库公开，默认分支为 `main`。
- 服务器为 Ubuntu 22.04、x86_64、2 核、2GB 内存、约 43GB 可用磁盘。
- SSH 登录用户为 `ubuntu`，可使用 `sudo`。
- 服务器当前未安装 Docker、Nginx 或 Node.js，80/443 端口未被占用。
- 应用数据保存在客户端 IndexedDB，服务器部署不迁移或存储用户语言块。

## 架构

### 应用容器

- 仓库新增多阶段 `Dockerfile`，使用 Node.js 22 构建现有 Vinext 应用。
- 构建阶段执行 `npm ci`、`npm test` 和 `npm run build`。
- 运行阶段仅保留生产运行所需文件和依赖，以非 root 用户启动。
- 容器内部监听 3000 端口，主机将 80 端口映射到容器 3000 端口。
- `docker compose` 设置 `restart: unless-stopped`，服务器重启后自动恢复。

### 自动部署

- `.github/workflows/deploy.yml` 仅在 `main` 推送或手动触发时运行。
- CI 阶段使用 GitHub 托管 Runner 安装 Node.js 22，执行 `npm ci`、`npm test` 和 `npm run build`。
- CI 通过后，部署阶段使用专用 SSH 私钥连接 `ubuntu@43.153.204.17`。
- 服务器在固定目录 `/opt/phrase-bank` 克隆或快进拉取公开仓库。
- 服务器运行 `docker compose build`，构建成功后运行 `docker compose up -d`。
- 构建失败时不执行替换，现有容器继续运行。
- 部署后在服务器本机请求 `http://127.0.0.1/`；健康检查失败则工作流失败并保留诊断输出。

## SSH 与机密

- 创建一把专用于 GitHub Actions 到腾讯云的 ED25519 密钥。
- 公钥追加到服务器 `ubuntu` 用户的 `~/.ssh/authorized_keys`。
- 私钥仅保存为 GitHub Actions 仓库 Secret `TENCENT_SSH_KEY`，不写入仓库、服务器项目目录、日志或聊天。
- 其他 Secrets：`TENCENT_HOST=43.153.204.17`、`TENCENT_USER=ubuntu`。
- `known_hosts` 由工作流在连接前通过 `ssh-keyscan` 建立；部署命令仍启用主机密钥检查。
- 初始密码登录完成密钥安装后，后续自动部署不再使用服务器密码。

## 服务器准备

- 使用 Ubuntu 官方包索引与 Docker 官方仓库安装 Docker Engine 和 Compose 插件。
- 将 `ubuntu` 加入 `docker` 组；自动部署命令可在当前会话使用 `sudo docker`，避免依赖组权限立即刷新。
- 创建 `/opt/phrase-bank`，所有权交给 `ubuntu`。
- 不修改 SSH 密码认证策略，不关闭现有登录方式，避免意外锁定用户。
- 检查 UFW；若已启用则允许 TCP 80，不改变其他规则。
- 腾讯云安全组不在服务器操作范围内；若公网 80 不通，需要用户在控制台放行 TCP 80。

## 回退与安全

- CI 测试失败时不连接服务器。
- Docker 镜像构建失败时旧容器保持运行。
- 新容器启动后健康检查失败时，工作流报告失败；首版不自动回退到上一个镜像标签，避免未经验证的复杂回退逻辑。
- Docker 只暴露 80 端口；应用容器不直接开放管理端口。
- 仓库不包含服务器密码、SSH 私钥或 GitHub Token。
- 由于服务器密码曾用于交互登录，部署完成后建议用户在腾讯云控制台或 SSH 中更换密码。

## GitHub Secrets 配置

由于当前 GitHub API 登录受网络限制，Secrets 通过 GitHub 网页设置：

1. 打开仓库 Settings → Secrets and variables → Actions。
2. 新增 `TENCENT_HOST`、`TENCENT_USER` 和 `TENCENT_SSH_KEY`。
3. 私钥通过本地安全界面复制，不在聊天中显示。
4. Secrets 保存后手动触发一次 Deploy 工作流。

## 验收

- 本地 `npm test` 和 `npm run build` 通过。
- Docker 镜像在服务器成功构建，容器状态为 running/healthy。
- 服务器本机 `http://127.0.0.1/` 返回成功状态并包含 Phrase Bank 页面。
- 公网 `http://43.153.204.17` 可访问；若服务器本机成功但公网失败，定位为腾讯云安全组问题。
- GitHub Actions 可手动触发并成功完成测试与部署。
- 再次推送 `main` 可自动部署，且客户端已有 IndexedDB 数据保持不变。
