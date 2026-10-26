import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { contentFingerprint } from "../document-meta.js";

it("upgrades an existing knowledge database without changing document bodies", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kb-migrate-"));
  process.env.DATA_DIR = directory;
  const original = new Database(path.join(directory, "knowledge.db"));
  const schema = fs.readFileSync(new URL("../../schema.sql", import.meta.url), "utf8").split("CREATE TABLE IF NOT EXISTS folder_cache_state")[0];
  original.exec(schema);
  original.prepare("INSERT INTO users(id,email,username,password_hash,created_at) VALUES('u','u@test','u','x','now')").run();
  original.prepare("INSERT INTO sources(id,user_id,name,type,config_enc,created_at,updated_at) VALUES('s','u','s','local','x','now','now')").run();
  const content = "旧数据正文保持原样。".repeat(20);
  original.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,file_hash,created_at,updated_at) VALUES('d','u','s','a/b.md','file','Old',?,'legacy-hash','now','now')").run(content);
  original.close();
  let db: Database.Database | undefined;
  try {
    db = (await import("../../db.js")).db;
    const row = db.prepare("SELECT content,file_hash FROM documents WHERE id='d'").get() as { content: string; file_hash: string };
    expect(row.content).toBe(content);
    expect(row.file_hash).toBe(contentFingerprint(content));
    expect(db.prepare("SELECT value FROM app_settings WHERE key='fingerprint_v1'").get()).toEqual({ value: "1" });
    const { sourceFolders } = await import("../folders.js");
    expect(sourceFolders("u", "s", "").items).toEqual([{ path: "a", count: 1, hasChildren: false }]);
  } finally { db?.close(); await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
