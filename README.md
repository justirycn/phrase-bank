# Phrase Bank

一个面向中文学习者的英语语言块学习应用，支持系统句库、个人句子、每日新句、间隔复习、口语训练和手机/电脑云端同步。

## 核心能力

- 2,000 条版本化系统内容，包含核心句和场景例句
- 每日新句、到期复习、三日掌握和自主练习
- 手机与电脑共用账号进度
- 带版本号的冲突安全同步：旧设备不会直接覆盖新数据
- Chromium 与移动 WebKit 关键流程回归
- 隐私安全的客户端故障代码、SQLite 健康检查和精确 SHA 部署

## 本地开发

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

常用检查：

```bash
npm test
npm run lint
npm run build
npm run test:e2e
npm run test:home-performance
```

`test:e2e` 使用正式构建，并运行桌面 Chromium 与 iPhone 尺寸 WebKit。首次运行前安装浏览器：

```bash
npx playwright install chromium webkit
```

## 数据与同步

浏览器使用账号独立的 IndexedDB 工作副本，服务端使用 SQLite 保存云端快照。每次写入携带文档版本；检测到另一台设备已先保存时，客户端会读取最新快照、重放当前操作并重试。未被云端确认的本地修改会回滚并向用户显示失败，不会静默覆盖另一台设备。

生产数据库路径由 `PHRASE_DB_PATH` 指定。账号与备份操作见 [账号与云端数据手册](docs/runbooks/account-and-cloud-data.md)。

## 故障监控

客户端只上报预定义的故障代码、所在页面、联网状态和重试次数，不上报句子、翻译、录音、密码或任意错误文本。服务端保留每个账号最近 500 条诊断记录，并在结构化日志中记录部署版本。

`/api/health` 会检查应用和 SQLite 连接，Docker 健康检查及部署脚本都使用该接口。

## 部署

推送到 `main` 后，GitHub Actions 会依次执行单元测试、代码规范、正式构建、性能门槛、Chromium/WebKit 流程测试，然后按精确提交 SHA 部署到腾讯云。部署脚本仅在内外网健康检查都通过后更新部署标记。
