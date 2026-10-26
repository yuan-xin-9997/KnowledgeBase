import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appSecret, config } from "../config.js";
import { db, getSetting, setSetting } from "../db.js";
import { fileDigest, restoreSnapshot } from "./backup-files.js";
import { HttpError } from "../util.js";

const root = path.join(config.dataDir, "backups");
let busy = false;
function location(id: string) {
  if (!/^backup-[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "无效备份编号");
  return path.join(root, id);
}
async function verify(id: string) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kb-restore-"));
  try {
    const counts = await restoreSnapshot(location(id), path.join(temporary, "restored"));
    const result = { ok: true, verifiedAt: new Date().toISOString(), ...counts };
    await fs.writeFile(path.join(location(id), "verification.json"), JSON.stringify(result), { mode: 0o600 });
    return result;
  } finally { if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith("kb-restore-")) throw new Error("无效临时目录"); await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function listBackups() {
  const attempt = JSON.parse(getSetting("backup_last_attempt") || "null");
  if (!busy && attempt?.status === "running") setSetting("backup_last_attempt", JSON.stringify({ ...attempt, status: "error", error: "上次操作被服务重启或恢复中断，请重新创建或验证备份" }));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const items = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^backup-[a-f0-9-]{36}$/.test(entry.name)) continue;
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, entry.name, "manifest.json"), "utf8"));
      let verification = null;
      try { verification = JSON.parse(await fs.readFile(path.join(root, entry.name, "verification.json"), "utf8")); } catch { /* Not yet verified. */ }
      items.push({ id: entry.name, createdAt: manifest.createdAt, size: (await fs.stat(path.join(root, entry.name, "knowledge.db"))).size, verification });
    } catch { items.push({ id: entry.name, createdAt: "", size: 0, verification: null, error: "备份未完成或不可读" }); }
  }
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), busy, lastAttempt: JSON.parse(getSetting("backup_last_attempt") || "null") };
}
export async function createBackup() {
  if (busy) throw new HttpError(409, "已有备份或验证任务正在运行");
  busy = true;
  const id = "backup-" + crypto.randomUUID();
  const directory = location(id);
  setSetting("backup_last_attempt", JSON.stringify({ status: "running", time: new Date().toISOString() }));
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await db.backup(path.join(directory, "knowledge.db"));
    await fs.chmod(path.join(directory, "knowledge.db"), 0o600);
    await fs.writeFile(path.join(directory, "secret.key"), appSecret, { mode: 0o600 });
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), databaseHash: await fileDigest(path.join(directory, "knowledge.db")), secretHash: await fileDigest(path.join(directory, "secret.key")) }), { mode: 0o600 });
    const verification = await verify(id);
    setSetting("backup_last_attempt", JSON.stringify({ status: "success", time: new Date().toISOString(), id }));
    return { id, verification };
  } catch (error) {
    setSetting("backup_last_attempt", JSON.stringify({ status: "error", time: new Date().toISOString(), error: error instanceof Error ? error.message : "备份失败" }));
    throw error;
  } finally { busy = false; }
}
export async function verifyBackup(id: string) {
  if (busy) throw new HttpError(409, "已有备份或验证任务正在运行");
  busy = true;
  try { return await verify(id); }
  catch (error) {
    const message = error instanceof Error ? error.message : "验证失败";
    await fs.writeFile(path.join(location(id), "verification.json"), JSON.stringify({ ok: false, verifiedAt: new Date().toISOString(), error: message }), { mode: 0o600 }).catch(() => {});
    throw error;
  } finally { busy = false; }
}
