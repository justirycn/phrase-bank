import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AuthStore } from "../app/server/authStore";

const action = process.argv[2]; const username = process.argv[3];
const store = new AuthStore(process.env.PHRASE_DB_PATH ?? "./data/phrase-bank.sqlite");
if (action === "list") { console.table(store.listUsers()); process.exit(0); }
if (!username) throw new Error("请提供账号名");
if (action === "disable" || action === "enable") await store.setEnabled(username, action === "enable");
else if (action === "create" || action === "reset") {
  const terminal = createInterface({ input: stdin, output: stdout });
  const password = await terminal.question("请输入密码："); terminal.close();
  if (action === "create") await store.createUser(username, password); else await store.resetPassword(username, password);
} else throw new Error("支持 create/reset/disable/enable/list");
console.log("操作完成");
