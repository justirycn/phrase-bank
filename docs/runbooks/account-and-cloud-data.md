# 账号与云端数据操作

在服务器项目目录执行：

- 创建账号：`docker compose exec phrase-bank npm run account:create -- 用户名`，按提示输入密码。
- 重设密码：`docker compose exec phrase-bank npm run account:reset -- 用户名`。
- 停用/启用：`docker compose exec phrase-bank npm run account:disable -- 用户名` / `account:enable`。
- 查看账号：`docker compose exec phrase-bank npm run account:list`。

数据库保存在 Docker 卷 `phrase_data`，重建容器不会删除。备份前停止应用写入，然后复制 `/app/data/phrase-bank.sqlite`；恢复前保留当前文件副本。密码不要写入命令、配置或聊天记录。
