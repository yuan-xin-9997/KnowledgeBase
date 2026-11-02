import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { initializeAdmin } from "../server/dist/initialize.js";
import { db } from "../server/dist/db.js";

// Require an interactive terminal so passwords never appear in arguments or env files.
let hidden = false;
const output = new Writable({ write(chunk, _encoding, done) {
  if (!hidden) process.stdout.write(chunk);
  done();
} });
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
try {
  if (!process.stdin.isTTY) throw new Error("请在交互终端运行初始化命令");
  const email = await rl.question("管理员邮箱: ");
  const username = await rl.question("管理员用户名: ");
  process.stdout.write("密码（至少 8 位，不回显）: ");
  hidden = true;
  const password = await rl.question("");
  hidden = false;
  process.stdout.write("\n");
  await initializeAdmin({ email, username, password });
  console.log("管理员初始化完成，请在网页登录。");
} catch {
  console.error("初始化失败：需要交互终端、空库、有效邮箱/用户名及 8–72 字节密码；已有用户无需初始化。");
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
