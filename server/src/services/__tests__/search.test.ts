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
  it("keeps readable body text in previews instead of long source links and Markdown", () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,email,username,password_hash,created_at) VALUES(?,?,?,?,?)")
      .run("preview-user", "preview@test.local", "preview", "x", now);
    db.prepare("INSERT INTO sources(id,user_id,name,type,config_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run("preview-source", "preview-user", "Cubox", "cubox", "x", now, now);
    db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("preview-doc", "preview-user", "preview-source", "article", "article", "知识管理",
        "# 知识管理\n\n[mp.weixin.qq.com](https://mp.weixin.qq.com/s?token=" + "x".repeat(600)
        + ")\n\n?imageUrl=https%3A%2F%2Fexample.com%2Fimage.png)\n\n**真正的正文内容讲述如何组织知识与有效阅读。**", now, now);
    search.indexDocument("preview-doc");
    const result = search.searchDocuments({ userId: "preview-user", query: "真正" });
    expect(result.items[0].snippet).toContain("真正的正文内容");
    expect(result.items[0].snippet).not.toContain("https://");
    expect(result.items[0].snippet).not.toContain("mp.weixin.qq.com");
    expect(result.items[0].snippet).not.toContain("**");
    expect(result.items[0].snippet).not.toContain("imageUrl=");
  });
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

describe("explicitly named documents in RAG", () => {
  const book = "《ENERGY AND ENVIRONMENT》";
  const article = "10月份漏洞满天飞，PHP/Java/NodeJS/GitLab/Linux，你的服务安全吗？";
  const query = `请分别介绍《${book}》和《${article}》并引用`;
  const owner = "rag-owner";
  const sources = ["rag-nas", "rag-cubox"];

  beforeAll(() => {
    const now = new Date().toISOString();
    const userInsert = db.prepare("INSERT INTO users(id,email,username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?,?,?)");
    for (const id of [owner, "rag-other"]) userInsert.run(id, `${id}@test.local`, id, "x", id, "user", now);
    const sourceInsert = db.prepare("INSERT INTO sources(id,user_id,name,type,config_enc,enabled,sync_interval_minutes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
    for (const id of [...sources, "rag-hidden", "rag-other-source"]) {
      sourceInsert.run(id, id === "rag-other-source" ? "rag-other" : owner, id, "local", "x", 1, 0, now, now);
    }
    const insert = db.prepare(`INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,content_format,source_created_at,created_at,updated_at,deleted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const add = (id: string, sourceId: string, title: string, content: string, deleted = false) => {
      insert.run(id, sourceId === "rag-other-source" ? "rag-other" : owner, sourceId, id, "file", title, content, "text", now, now, now, deleted ? now : null);
      search.indexDocument(id);
    };
    const chunk = (content: string) => content.padEnd(1800, ".");
    const bookContent = Array.from({ length: 14 }, (_, index) => chunk(index < 6
      ? `ENERGY AND ENVIRONMENT chapter ${index}: integrated assessment, bottom-up models and differential games.`
      : `PHP Java NodeJS GitLab Linux appendix ${index}: unrelated software catalog.`)).join("");
    add("rag-book", sources[0], book, bookContent);
    add("rag-article", sources[1], article, "文章分析软件漏洞并建议及时更新补丁。");
    // These documents match every word of the question, so ordinary AND retrieval crowds out the book.
    for (let index = 0; index < 12; index += 1) add(`rag-popular-${index}`, sources[1], `热门综合资料 ${index}`, query.repeat(4));
    add("rag-hidden-book", "rag-hidden", book, "An excluded source must never enter the context.");
    add("rag-foreign-book", "rag-other-source", book, "Another user's private copy.");
    add("rag-deleted-book", sources[0], book, "A deleted copy.", true);
  });

  it("reserves places for two named titles before filling with popular-source search results", () => {
    const ordinary = search.searchDocuments({ userId: owner, query, sourceIds: sources, pageSize: 8 }).items;
    expect(ordinary).toHaveLength(8);
    expect(ordinary.every((item) => item.id.startsWith("rag-popular-"))).toBe(true);
    const result = search.retrieveForAi(owner, query, { sourceIds: sources }, 3);
    expect(result.slice(0, 2).map((item) => item.id)).toEqual(["rag-book", "rag-article"]);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((item) => item.id)).size).toBe(3);
  });

  it("normalizes nested book brackets, Unicode width, whitespace and title case", () => {
    const result = search.retrieveForAi(owner, "介绍《《ｅｎｅｒｇｙ   and environment》》", { sourceIds: [sources[0]] });
    expect(result[0]?.id).toBe("rag-book");
  });

  it("keeps named-title lookup inside source, user, deletion and explicit-document filters", () => {
    const onlyCubox = search.retrieveForAi(owner, query, { sourceIds: [sources[1]] });
    expect(onlyCubox.some((item) => item.id === "rag-book")).toBe(false);
    expect(onlyCubox.every((item) => item.sourceId === sources[1])).toBe(true);
    const allowed = search.retrieveForAi(owner, query, { sourceIds: [...sources, "rag-other-source"] });
    expect(allowed.some((item) => ["rag-hidden-book", "rag-foreign-book", "rag-deleted-book"].includes(item.id))).toBe(false);
    expect(search.retrieveForAi("missing-user", query, {})).toEqual([]);
    expect(search.retrieveForAi(owner, query, { sourceIds: [sources[1]], documentIds: ["rag-book", "rag-foreign-book"] })).toEqual([]);
  });

  it("uses each named document's own title when choosing passages for a combined question", () => {
    const single = search.retrieveForAi(owner, `请介绍《${book}》并引用`, { documentIds: ["rag-book"] })[0];
    const combined = search.retrieveForAi(owner, `请介绍《${book}》和《${article}》并引用`, { sourceIds: sources })[0];
    expect(combined.id).toBe("rag-book");
    expect(combined.content).toBe(single.content);
    expect(combined.content).toContain("integrated assessment");
    expect(combined.content).not.toContain("unrelated software catalog");
    const focused = search.retrieveForAi(owner, "PHP Java NodeJS GitLab Linux", { documentIds: ["rag-book"] })[0];
    expect(focused.content).toContain("unrelated software catalog");
  });

  it("does not inject an unrelated source for an ordinary question without named titles", () => {
    const result = search.retrieveForAi(owner, "及时更新补丁", { sourceIds: sources });
    expect(result.map((item) => item.id)).toEqual(["rag-article"]);
  });
});
