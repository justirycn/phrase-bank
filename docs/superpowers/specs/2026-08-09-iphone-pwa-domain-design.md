# Phrase Bank iPhone 可安装应用与独立域名设计

## 目标

将现有 Phrase Bank 从 `http://43.153.204.17` 迁移到 `https://phrase.archdemy.com`，使用户可以通过 iPhone Safari 添加到主屏幕，并以独立、全屏的应用形态使用。继续沿用现有腾讯云服务器和 GitHub 自动部署。

## 已确认选择

- 使用子域名 `phrase.archdemy.com`，不占用 `www.archdemy.com`。
- 服务器位于腾讯云新加坡地域 `ap-singapore`，域名指向该境外服务器无需 ICP 备案。
- 本阶段采用 PWA 安装方式，不开发 App Store 原生应用。
- 本阶段不增加 Service Worker 或离线缓存，避免缓存旧版本影响更新稳定性。

## 域名与 HTTPS

1. 在 `archdemy.com` 的 DNS 服务商处新增 A 记录：
   - 主机记录：`phrase`
   - 记录值：`43.153.204.17`
2. 在服务器入口增加支持自动签发和续期证书的 HTTPS 反向代理。
3. `https://phrase.archdemy.com` 转发到现有 Phrase Bank 容器。
4. `http://phrase.archdemy.com` 永久重定向到 HTTPS。
5. 原 IP 地址在迁移期间继续可访问，作为旧数据导出入口。

## iPhone 安装体验

应用继续使用现有 Web App Manifest、Apple Touch Icon、standalone 显示模式和安全区适配。用户在 iPhone Safari 中打开 `https://phrase.archdemy.com`，选择“分享 → 添加到主屏幕”，之后从 Phrase Bank 图标启动。启动后不显示 Safari 地址栏，交互与独立 App 一致。

## 数据迁移与保护

Phrase Bank 数据保存在浏览器 IndexedDB 中，并按来源网址隔离。因此 `http://43.153.204.17` 与 `https://phrase.archdemy.com` 拥有两套独立本地数据，不能自动共享。

迁移顺序：

1. 在旧 IP 地址的设置页导出 JSON 备份。
2. 打开新 HTTPS 域名并确认应用可用。
3. 在新域名的设置页导入 JSON 备份。
4. 核对分类、语言块和训练记录数量。
5. 数据确认后再从 iPhone 主屏幕安装。

旧 IP 地址在用户完成迁移确认前不得关闭或强制跳转，以确保旧数据仍可导出。部署操作不得清空浏览器数据或服务器目录。

## 部署与运维

- GitHub `main` 分支仍触发自动测试、构建和腾讯云部署。
- HTTPS 代理配置纳入代码仓库和容器编排，保证服务器重建后可恢复。
- 证书和代理持久化数据使用专用 Docker volume。
- 应用容器不再直接占用公网 80 端口，由 HTTPS 代理统一对外提供 80/443。
- 腾讯云防火墙需允许 TCP 80 和 443；SSH 22 保持现有规则。

## 错误处理

- DNS 未生效时不修改现有线上入口。
- 证书签发失败时保留旧 IP 服务，并检查 DNS、80/443 防火墙和域名解析。
- 新域名应用异常时不执行数据删除，通过旧 IP 继续使用和导出。
- 部署完成必须同时验证 HTTPS 证书、HTTP 跳转、manifest、Apple 图标、训练流程和服务器健康状态。

## 验收标准

- `phrase.archdemy.com` 正确解析到 `43.153.204.17`。
- HTTPS 证书有效，浏览器无安全警告。
- HTTP 域名自动跳转到 HTTPS。
- iPhone Safari 可显示“添加到主屏幕”，桌面图标及名称正确。
- 从桌面启动后为 standalone 应用窗口，安全区和底部操作正常。
- 麦克风请求可正常触发，训练可开始并保存进度。
- 旧 IP 地址仍可访问，备份导出与新域名导入流程验证通过。
- GitHub 自动部署与后续更新保持正常。

