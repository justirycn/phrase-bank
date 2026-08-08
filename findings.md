# 部署发现

- GitHub 仓库：`justirycn/phrase-bank`，公开，`main` 分支。
- 腾讯云：Ubuntu 22.04.5 LTS、x86_64、2 核、2GB 内存、50GB 系统盘。
- 公网 IP：`43.153.204.17`；SSH 用户：`ubuntu`。
- 当前仅安装 Git；Docker、Nginx、Node.js 未安装。
- 80/443 端口未占用，SSH 使用 22 端口。
- 应用状态完全位于浏览器 IndexedDB，服务端无业务数据库。
- GitHub API/CLI 网页认证受本机网络限制，Secrets 需要网页配置。
- GitHub Actions 的远程 SSH 会话无法交互输入 sudo 密码；部署用户必须通过 `docker` 组直接运行 Docker，工作流不能使用 `sudo docker`。
