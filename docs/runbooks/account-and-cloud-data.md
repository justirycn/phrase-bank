# 账号与云端数据操作

在服务器项目目录执行：

- 创建账号：`docker compose exec phrase-bank npm run account:create -- 用户名`，按提示输入密码。
- 重设密码：`docker compose exec phrase-bank npm run account:reset -- 用户名`。
- 停用/启用：`docker compose exec phrase-bank npm run account:disable -- 用户名` / `account:enable`。
- 查看账号：`docker compose exec phrase-bank npm run account:list`。

数据库保存在 Docker 卷 `phrase_data`，重建容器不会删除。备份前停止应用写入，然后复制 `/app/data/phrase-bank.sqlite`；恢复前保留当前文件副本。密码不要写入命令、配置或聊天记录。

## 同步与诊断

- 每份账号数据都有递增版本号。遇到手机和电脑同时修改时，旧设备会读取最新版本并重放当前操作；服务端拒绝无版本或过期的整份覆盖。
- 健康检查：`curl --fail https://phrase.archdemy.com/api/health`。返回 `ok: true` 才表示应用和 SQLite 都可用。
- 查看最近的结构化故障日志：`docker compose logs --tail=500 phrase-bank | grep phrase_bank_client_diagnostic`。
- 客户端诊断只包含故障代码、页面、联网状态、重试次数和部署版本，不包含句子、翻译、录音或密码。数据库为每个账号最多保留 500 条。
