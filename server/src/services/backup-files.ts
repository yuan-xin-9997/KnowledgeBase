import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

export async function fileDigest(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function verifySnapshot(directory: string) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")) as { databaseHash: string; secretHash: string };
  for (const [file, hash] of [["knowledge.db", manifest.databaseHash], ["secret.key", manifest.secretHash]]) {
    if (await fileDigest(path.join(directory, file)) !== hash) throw new Error("备份校验和不匹配：" + file);
  }
  const restored = new Database(path.join(directory, "knowledge.db"), { readonly: true, fileMustExist: true });
  try {
    if (restored.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("数据库完整性校验失败");
    if ((restored.pragma("foreign_key_check") as unknown[]).length) throw new Error("数据库关联校验失败");
    const secret = await fs.readFile(path.join(directory, "secret.key"), "utf8");
    const key = crypto.createHash("sha256").update(secret).digest();
    const encrypted = restored.prepare("SELECT config_enc AS value FROM sources UNION ALL SELECT api_key_enc AS value FROM ai_providers");
    for (const { value } of encrypted.iterate() as Iterable<{ value: string }>) {
      const [version, iv, tag, data] = value.split(":");
      if (version !== "v1" || !iv || !tag || !data) throw new Error("备份中的加密配置格式无效");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
    }
    return { users: (restored.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n,
      documents: (restored.prepare("SELECT COUNT(*) n FROM documents WHERE deleted_at IS NULL").get() as { n: number }).n,
      sources: (restored.prepare("SELECT COUNT(*) n FROM sources").get() as { n: number }).n };
  } finally { restored.close(); }
}

// Restore only into a newly created, empty directory; never overwrite a live database.
export async function restoreSnapshot(backup: string, target: string) {
  const source = await fs.realpath(backup);
  const destination = path.resolve(target);
  if (destination === source || destination.startsWith(source + path.sep)) throw new Error("恢复目录必须与备份分离");
  await verifySnapshot(source);
  await fs.mkdir(destination, { mode: 0o700 });
  try {
    for (const file of ["knowledge.db", "secret.key", "manifest.json"]) await fs.copyFile(path.join(source, file), path.join(destination, file), 1);
    await fs.chmod(path.join(destination, "knowledge.db"), 0o600);
    await fs.chmod(path.join(destination, "secret.key"), 0o600);
    return await verifySnapshot(destination);
  } catch (error) { throw new Error("恢复失败，已保留独立目录供检查；原系统未修改：" + (error instanceof Error ? error.message : error)); }
}
