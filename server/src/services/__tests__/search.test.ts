import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir: string;
let db: typeof import("../../db.js").db;
let search: typeof import("../search.js");

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-search-"));
  process.env.DATA_DIR = tempDir;
  const dbModule = await import("../../db.js");
  db = dbModule.db;
  search = await import("../search.js");
});

afterAll(() => {
  db?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("search", () => {
  it("normalises CJK text into character tokens", () => {
    expect(search.toFtsText("人工智能 AI")).toBe("人 工 智 能 ai");
    expect(search.buildMatchQuery("人工智能 金融")).toBe('"人 工 智 能" AND "金 融"');
    expect(search.buildMatchQuery("mach")).toBe('"mach"*');
  });

  it("finds Chinese phrase, title-only and tag-filtered results", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users(id,email,username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run("u1", "search@test.local", "searchuser", "x", "S", "user", now);
    db.prepare(
      "INSERT INTO sources(id,user_id,name,type,config_enc,enabled,sync_interval_minutes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run("s1", "u1", "NAS", "local", "x", 1, 0, now, now);

    const insert = db.prepare(
      `INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,content_format,source_created_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run("d1", "u1", "s1", "d1", "file", "人工智能在金融中的应用", "机器学习与风险控制。", "text", now, now, now);
    insert.run("d2", "u1", "s1", "d2", "file", "宏观经济学笔记", "通货膨胀与货币政策。", "text", now, now, now);
    db.prepare("INSERT INTO document_tags(document_id,tag) VALUES(?,?)").run("d2", "经济");
    search.indexDocument("d1");
    search.indexDocument("d2");

    const chinese = search.searchDocuments({ userId: "u1", query: "人工智能" });
    expect(chinese.total).toBe(1);
    expect(chinese.items[0]?.title).toContain("人工智能");

    const titleOnly = search.searchDocuments({ userId: "u1", query: "宏观", mode: "title" });
    expect(titleOnly.total).toBe(1);
    expect(titleOnly.items[0]?.id).toBe("d2");

    const tagged = search.searchDocuments({ userId: "u1", query: "政策", tag: "经济" });
    expect(tagged.total).toBe(1);

    const otherUser = search.searchDocuments({ userId: "u2", query: "人工智能" });
    expect(otherUser.total).toBe(0);
  });
});
