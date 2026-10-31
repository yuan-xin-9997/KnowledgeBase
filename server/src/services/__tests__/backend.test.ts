import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

let tempDir: string;
let db: typeof import("../../db.js").db;
let app: FastifyInstance;
let ownerCookie: string;
let secondCookie: string;
let sourceId: string;
let search: typeof import("../search.js");
let rag: typeof import("../rag.js");
let ai: typeof import("../ai.js");
let provider: ReturnType<typeof ai.createProvider>;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-backend-"));
  process.env.DATA_DIR = tempDir;
  db = (await import("../../db.js")).db;
  search = await import("../search.js");
  rag = await import("../rag.js");
  ai = await import("../ai.js");
  const auth = await import("../../auth.js");
  app = Fastify();
  await app.register(cookie);
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => { request.user = auth.userFromRequest(request); });
  for (const route of [
    await import("../../routes/backups.js"), await import("../../routes/auth.js"), await import("../../routes/sources.js"),
    await import("../../routes/documents.js"), await import("../../routes/providers.js"),
    await import("../../routes/chat.js"), await import("../../routes/search.js"),
  ]) {
    await app.register(route.default);
  }
  const register = async (username: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      username, email: `${username}@test.local`, password: "StrongTestPassword!",
    } });
    expect(response.statusCode).toBe(201);
    return { cookie: String(response.headers["set-cookie"]).split(";")[0], user: response.json().user };
  };
  const owner = await register("owner");
  const second = await register("second");
  ownerCookie = owner.cookie;
  secondCookie = second.cookie;
  expect(owner.user.role).toBe("admin");
  expect(second.user.role).toBe("user");
  const response = await app.inject({ method: "POST", url: "/api/sources", headers: { cookie: ownerCookie }, payload: {
    name: "Private materials", type: "local", config: { path: tempDir },
  } });
  expect(response.statusCode).toBe(201);
  sourceId = response.json().source.id;
  const now = "2026-10-24T04:00:00.000Z";
  fs.writeFileSync(path.join(tempDir, "sample.txt"), "0123456789");
  const insert = db.prepare(`INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,content_format,file_path,published_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("private-doc", owner.user.id, sourceId, "first", "file", "机器学习专业资料", "金融风险控制。" + "无关背景。".repeat(5000) + "尾部特征：梯度爆炸需要裁剪梯度。", "text", path.join(tempDir, "sample.txt"), now, now, now);
  insert.run("web-doc", owner.user.id, sourceId, "second", "bookmark", "普通收藏", "机器学习需要数据。", "text", null, now, now, now);
  search.indexDocument("private-doc");
  search.indexDocument("web-doc");
  provider = ai.createProvider(owner.user.id, { name: "test", protocol: "openai", baseUrl: "https://example.test/v1", apiKey: "private-model-key", model: "test-model" });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await app?.close();
  db?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("multi-user API boundaries", () => {
  it("filters formats consistently in lists and search, scoped to the owner and source", async () => {
    db.prepare("UPDATE documents SET mime_type = 'application/pdf' WHERE id = 'private-doc'").run();
    try {
      const formats = await app.inject({ url: `/api/documents/formats?sourceId=${sourceId}`, headers: { cookie: ownerCookie } });
      expect(formats.json().formats).toContain("pdf");
      expect((await app.inject({ url: `/api/documents/formats?sourceId=${sourceId}`, headers: { cookie: secondCookie } })).json().formats).toEqual([]);
      for (const endpoint of ["documents", "search"]) {
        const result = await app.inject({ url: `/api/${endpoint}?format=pdf&q=` + encodeURIComponent("机器学习"), headers: { cookie: ownerCookie } });
        expect(result.json().items.map((item: { id: string }) => item.id)).toEqual(["private-doc"]);
        expect((await app.inject({ url: `/api/${endpoint}?format=mp3`, headers: { cookie: ownerCookie } })).json().total).toBe(0);
      }
    } finally { db.prepare("UPDATE documents SET mime_type = NULL WHERE id = 'private-doc'").run(); }
  });
  it("requires authentication and isolates sources, documents, files and model configs", async () => {
    expect((await app.inject("/api/documents")).statusCode).toBe(401);
    for (const url of [`/api/sources/${sourceId}`, "/api/documents/private-doc", "/api/documents/private-doc/file"]) {
      expect((await app.inject({ url, headers: { cookie: secondCookie } })).statusCode).toBe(404);
    }
    const providers = await app.inject({ url: "/api/providers", headers: { cookie: secondCookie } });
    expect(providers.json().providers).toEqual([]);
    const result = await app.inject({ url: "/api/search?q=机器学习", headers: { cookie: secondCookie } });
    expect(result.json().total).toBe(0);
  });

  it("serves relative images read-only and isolates source folders", async () => {
    const ownerId = (db.prepare("SELECT user_id FROM sources WHERE id = ?").get(sourceId) as { user_id: string }).user_id;
    const now = new Date().toISOString();
    const insert = db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,content_format,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    insert.run("image-doc", ownerId, sourceId, "教程/子目录/说明.md", "file", "图片教程", '<img src="../../assets/测试.png" alt="示例" />', "markdown", now, now);
    insert.run("sibling-doc", ownerId, sourceId, "教程2/说明.md", "file", "其他", "", "text", now, now);
    fs.mkdirSync(path.join(tempDir, "assets"));
    const imagePath = path.join(tempDir, "assets", "测试.png");
    const image = Buffer.from("iVBORw0KGgo=", "base64");
    fs.writeFileSync(imagePath, image);
    const before = fs.statSync(imagePath).mtimeMs;
    const imageUrl = "/api/documents/image-doc/image?src=" + encodeURIComponent("../../assets/测试.png");
    expect((await app.inject(imageUrl)).statusCode).toBe(401);
    expect((await app.inject({ url: imageUrl, headers: { cookie: secondCookie } })).statusCode).toBe(404);
    const response = await app.inject({ url: imageUrl, headers: { cookie: ownerCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload).toEqual(image);
    for (const src of ["../../../outside.png", "%2e%2e/%2e%2e/%2e%2e/outside.png", "../../sample.txt", "file:///secret.png"]) {
      const result = await app.inject({ url: "/api/documents/image-doc/image?src=" + encodeURIComponent(src), headers: { cookie: ownerCookie } });
      expect([400, 403]).toContain(result.statusCode);
    }
    expect(fs.readFileSync(imagePath)).toEqual(image);
    expect(fs.statSync(imagePath).mtimeMs).toBe(before);
    expect((await app.inject({ url: "/api/documents/image-doc", headers: { cookie: ownerCookie } })).json().document.content).toContain("![示例]");
    expect((db.prepare("SELECT content FROM documents WHERE id = 'image-doc'").get() as { content: string }).content).toContain("<img");
    const foldersUrl = "/api/documents/folders?sourceId=" + sourceId;
    expect((await app.inject({ url: foldersUrl, headers: { cookie: ownerCookie } })).json().folders).toEqual(["教程", "教程/子目录", "教程2"]);
    expect((await app.inject({ url: foldersUrl, headers: { cookie: secondCookie } })).json().folders).toEqual([]);
    for (const endpoint of ["documents", "search"]) {
      const result = await app.inject({ url: `/api/${endpoint}?sourceId=${sourceId}&folder=` + encodeURIComponent("教程"), headers: { cookie: ownerCookie } });
      expect(result.json().items.map((item: { id: string }) => item.id)).toEqual(["image-doc"]);
    }
    db.prepare("DELETE FROM documents WHERE id IN ('image-doc', 'sibling-doc')").run();
  });

  it("reads SMB image paths inside the source base without using cached document paths", async () => {
    const smb = await import("../../connectors/smb.js");
    const readFile = vi.fn().mockResolvedValue(Buffer.from("image"));
    const disconnect = vi.fn();
    const factory = vi.spyOn(smb, "createClient").mockReturnValue({ readFile, disconnect, readdir: vi.fn() });
    try {
      const created = await app.inject({ method: "POST", url: "/api/sources", headers: { cookie: ownerCookie }, payload: {
        name: "SMB images", type: "smb", config: { host: "nas.test", share: "docs", username: "reader", password: "test", basePath: "资料" },
      } });
      expect(created.statusCode).toBe(201);
      const id = created.json().source.id;
      const owner = (db.prepare("SELECT user_id FROM sources WHERE id = ?").get(id) as { user_id: string }).user_id;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("smb-image-doc", owner, id, "资料/教程/文档.md", "file", "SMB", now, now);
      const url = (src: string) => "/api/documents/smb-image-doc/image?src=" + encodeURIComponent(src);
      expect((await app.inject({ url: url("../assets/a.png"), headers: { cookie: ownerCookie } })).statusCode).toBe(200);
      expect(readFile).toHaveBeenCalledWith("资料\\assets\\a.png");
      expect(disconnect).toHaveBeenCalledOnce();
      expect((await app.inject({ url: url("../../secret.png"), headers: { cookie: ownerCookie } })).statusCode).toBe(403);
      expect(readFile).toHaveBeenCalledOnce();
      // A full cache must not prevent reading a PDF directly from the source.
      db.prepare("UPDATE documents SET external_id = ?, mime_type = ?, file_path = ? WHERE id = ?")
        .run("资料/教程/文档.pdf", "application/pdf", path.join(tempDir, "missing.pdf"), "smb-image-doc");
      expect((await app.inject({ url: "/api/documents/smb-image-doc", headers: { cookie: ownerCookie } })).json().document.fileAvailable).toBe(true);
      const fileUrl = "/api/documents/smb-image-doc/file";
      const denied = await app.inject({ url: fileUrl, headers: { cookie: secondCookie } });
      expect(denied.statusCode).toBe(404);
      const pdf = await app.inject({ url: fileUrl, headers: { cookie: ownerCookie, range: "bytes=1-3" } });
      expect(pdf.statusCode).toBe(206);
      expect(pdf.headers["content-type"]).toBe("application/pdf");
      expect(pdf.headers["content-range"]).toBe("bytes 1-3/5");
      expect(pdf.body).toBe("mag");
      expect(readFile).toHaveBeenLastCalledWith("资料\\教程\\文档.pdf");
      readFile.mockRejectedValueOnce(new Error("secret credentials"));
      const failed = await app.inject({ url: fileUrl, headers: { cookie: ownerCookie } });
      expect(failed.statusCode).toBe(502);
      expect(failed.body).not.toContain("secret credentials");
      db.prepare("UPDATE documents SET external_id = ? WHERE id = ?").run("资料/../secret.pdf", "smb-image-doc");
      expect((await app.inject({ url: fileUrl, headers: { cookie: ownerCookie } })).statusCode).toBe(403);
      db.prepare("DELETE FROM documents WHERE id = 'smb-image-doc'").run();
      db.prepare("DELETE FROM sources WHERE id = ?").run(id);
    } finally { factory.mockRestore(); }
  });

  it("paginates folder children, counts descendants and invalidates cached counts", async () => {
    const ownerId = provider.user_id;
    const now = new Date().toISOString();
    const insert = db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
    insert.run("folder-a", ownerId, sourceId, "parent/a/doc.md", "file", "FolderA", "目录测试甲", now, now);
    insert.run("folder-b", ownerId, sourceId, "parent/b/doc.md", "file", "FolderB", "目录测试乙", now, now);
    const url = `/api/documents/folders?sourceId=${sourceId}&parent=`;
    const root = (await app.inject({ url, headers: { cookie: ownerCookie } })).json();
    expect(root.items).toContainEqual({ path: "parent", count: 2, hasChildren: true });
    const page = (await app.inject({ url: url + "parent&limit=1&offset=1", headers: { cookie: ownerCookie } })).json();
    expect(page.total).toBe(2);
    const trail = (await app.inject({ url: url + "&reveal=parent/b", headers: { cookie: ownerCookie } })).json();
    expect(trail.items.map((item: { path: string }) => item.path)).toEqual(["parent", "parent/b"]);
    expect(page.items).toEqual([{ path: "parent/b", count: 1, hasChildren: false }]);
    db.prepare("UPDATE documents SET deleted_at = ? WHERE id = 'folder-b'").run(now);
    expect((await app.inject({ url, headers: { cookie: ownerCookie } })).json().items).toContainEqual({ path: "parent", count: 1, hasChildren: true });
    expect((await app.inject({ url, headers: { cookie: secondCookie } })).json().items).toEqual([]);
    db.prepare("DELETE FROM documents WHERE id IN ('folder-a','folder-b')").run();
  });

  it("keeps AI folder constraints on exact-title and fallback retrieval and returns passage citations", () => {
    const now = new Date().toISOString();
    const insert = db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
    insert.run("scope-a", provider.user_id, sourceId, "allowed/doc.md", "file", "目录问答", "专属关键词。目录问答只允许读取这里。", now, now);
    insert.run("scope-b", provider.user_id, sourceId, "allowed2/doc.md", "file", "目录问答", "专属关键词。不能泄露的其他目录。", now, now);
    for (const id of ["scope-a", "scope-b"]) search.indexDocument(id);
    for (const query of ["《目录问答》", "专属关键词", "请用 专属关键词 做个总结"]) {
      const context = rag.retrieveContext(provider.user_id, query, { mode: "sources", sourceIds: [sourceId], documentIds: [], folder: "allowed" });
      expect(context.citations.map(item => item.documentId)).toEqual(["scope-a"]);
      expect(context.citations[0].excerpt).toContain("只允许读取这里");
      expect(context.block).not.toContain("不能泄露");
    }
    expect(rag.normalizeScope({ folder: null }, { mode: "sources", sourceIds: [sourceId], documentIds: [], folder: "allowed" }).folder).toBeUndefined();
    for (const id of ["scope-a", "scope-b"]) { search.removeFromIndex(id); db.prepare("DELETE FROM documents WHERE id = ?").run(id); }
  });

  it("identifies identical document bodies without exposing other users or merging files", async () => {
    const now = new Date().toISOString();
    const content = "相同正文用于重复检测。".repeat(12);
    const insert = db.prepare("INSERT INTO documents(id,user_id,source_id,external_id,kind,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
    for (const id of ["duplicate-a", "duplicate-b"]) { insert.run(id, provider.user_id, sourceId, id, "article", "重复示例", content, now, now); search.indexDocument(id); }
    const detail = (await app.inject({ url: "/api/documents/duplicate-a", headers: { cookie: ownerCookie } })).json().document;
    expect(detail.duplicates.map((item: { id: string }) => item.id)).toEqual(["duplicate-b"]);
    expect(search.searchDocuments({ userId: provider.user_id, query: "重复示例" }).items[0].duplicateCount).toBe(1);
    expect(search.searchDocuments({ userId: provider.user_id, query: "重复示例", deduplicate: true }).total).toBe(1);
    expect(search.searchDocuments({ userId: provider.user_id, query: "重复示例", mode: "title", deduplicate: true }).total).toBe(1);
    expect(search.retrieveForAi(provider.user_id, "重复示例", { documentIds: ["duplicate-a", "duplicate-b"] })).toHaveLength(1);
    expect((await app.inject({ url: "/api/documents/duplicate-a", headers: { cookie: secondCookie } })).statusCode).toBe(404);
    for (const id of ["duplicate-a", "duplicate-b"]) { search.removeFromIndex(id); db.prepare("DELETE FROM documents WHERE id = ?").run(id); }
  });

  it("restricts backups to admins and restores a validated snapshot into an isolated directory", async () => {
    expect((await app.inject("/api/backups")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/backups", headers: { cookie: secondCookie } })).statusCode).toBe(403);
    const result = await app.inject({ method: "POST", url: "/api/backups", headers: { cookie: ownerCookie } });
    expect(result.statusCode).toBe(200);
    const { id, verification } = result.json();
    expect(verification.ok).toBe(true);
    expect(verification.documents).toBe(2);
    const listing = (await app.inject({ url: "/api/backups", headers: { cookie: ownerCookie } })).json();
    expect(listing.items[0].verification.ok).toBe(true);
    const { restoreSnapshot } = await import("../backup-files.js");
    const backup = path.join(tempDir, "backups", id);
    const restored = path.join(tempDir, "restored");
    expect((await restoreSnapshot(backup, restored)).documents).toBe(2);
    await expect(restoreSnapshot(backup, restored)).rejects.toThrow();
    fs.appendFileSync(path.join(backup, "knowledge.db"), "tampered");
    const invalid = await app.inject({ method: "POST", url: `/api/backups/${id}/verify`, headers: { cookie: ownerCookie } });
    expect(invalid.statusCode).toBe(500);
    expect(invalid.json().error).toContain("校验和");
    expect((db.prepare("SELECT COUNT(*) n FROM documents").get() as { n: number }).n).toBe(2);
  });

  it("denies non-admin local file creation and arbitrary directory tests", async () => {
    for (const url of ["/api/sources", "/api/sources/test"]) {
      const response = await app.inject({ method: "POST", url, headers: { cookie: secondCookie }, payload: {
        name: "secrets", type: "local", config: { path: tempDir, includeExtensions: ["db", "key"] },
      } });
      expect(response.statusCode).toBe(403);
    }
  });

  it("does not return any portion of source credentials", async () => {
    const { sanitizeConfig } = await import("../sources.js");
    const result = sanitizeConfig({ apiLink: "https://cubox.pro/c/api/save/secret-token", token: "secret-token", password: "password", host: "nas" });
    expect(result.config).toEqual({ apiLink: "••••••••", token: "••••••••", password: "••••••••", host: "nas" });
  });

  it("honors title, body, attachment and complete-day filters", async () => {
    const query = async (params: string) => (await app.inject({ url: `/api/search?${params}`, headers: { cookie: ownerCookie } })).json();
    expect((await query("q=机器学习&mode=title")).total).toBe(1);
    expect((await query("q=机器学习&mode=content")).items.map((item: { id: string }) => item.id)).toEqual(["web-doc"]);
    expect((await query("q=机器学习&mode=attachment")).items.map((item: { id: string }) => item.id)).toEqual(["private-doc"]);
    expect((await query("from=2026-10-24&to=2026-10-24")).total).toBe(2);
    expect((await app.inject({ url: "/api/search?from=invalid", headers: { cookie: ownerCookie } })).statusCode).toBe(400);
  });

  it("supports suffix and oversized end byte ranges", async () => {
    for (const [range, expected] of [["bytes=-4", "6789"], ["bytes=8-100", "89"]]) {
      const response = await app.inject({ url: "/api/documents/private-doc/file", headers: { cookie: ownerCookie, range } });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe(expected);
      expect(response.headers["content-security-policy"]).toBe("sandbox");
    }
  });

  it("isolates conversation read and writes", async () => {
    const response = await app.inject({ method: "POST", url: "/api/chat/sessions", headers: { cookie: ownerCookie }, payload: { providerId: provider.id, scope: { mode: "none" } } });
    expect(response.statusCode).toBe(201);
    const id = response.json().session.id;
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      expect((await app.inject({ method, url: `/api/chat/sessions/${id}`, headers: { cookie: secondCookie }, ...(method === "PATCH" ? { payload: { title: "stolen" } } : {}) })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: "POST", url: `/api/chat/sessions/${id}/messages`, headers: { cookie: secondCookie }, payload: { content: "read secrets" } })).statusCode).toBe(404);
  });

  it("rejects passwords which bcrypt would silently truncate", async () => {
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      username: "longpassword", email: "longpassword@test.local", password: "密码".repeat(20),
    } });
    expect(response.statusCode).toBe(400);
  });

  it("deletes only the removed source's attachment cache and preserves local originals", async () => {
    const sources = await import("../sources.js");
    const { attachmentCacheDirectory } = await import("../../connectors/smb-cache.js");
    const row = sources.createSource(provider.user_id, { name: "cache deletion", type: "smb", config: {} });
    const dir = attachmentCacheDirectory(tempDir, provider.user_id, row.id);
    const neighbor = attachmentCacheDirectory(tempDir, provider.user_id, sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(neighbor, { recursive: true });
    fs.writeFileSync(path.join(dir, "a".repeat(64) + ".txt"), "removed");
    fs.writeFileSync(path.join(neighbor, "a".repeat(64) + ".txt"), "retained");
    sources.deleteSource(provider.user_id, row.id);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(neighbor)).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, "sample.txt"), "utf8")).toBe("0123456789");
  });
});

describe("AI scope and protocol handling", () => {
  it.each([{ error: { message: "token expired" } }, { choices: [] }])("rejects HTTP 200 errors and empty JSON instead of saving them as answers", async (payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    const onDelta = vi.fn();
    await expect(ai.streamChat({ provider, messages: [{ role: "user", content: "question" }], onDelta })).rejects.toBeInstanceOf(ai.AiError);
    expect(onDelta).not.toHaveBeenCalled();
    await expect(ai.completeOnce({ provider, messages: [{ role: "user", content: "question" }] })).rejects.toBeInstanceOf(ai.AiError);
  });
  it("retrieves natural-language matches and late passages only inside the requested scope", () => {
    const context = rag.retrieveContext(provider.user_id, "请解释梯度爆炸应该如何处理", { mode: "sources", sourceIds: [sourceId], documentIds: [] });
    expect(context.citations.map((item) => item.documentId)).toContain("private-doc");
    expect(context.block).toContain("裁剪梯度");
    expect(rag.retrieveContext("other-user", "梯度", { mode: "documents", sourceIds: [], documentIds: ["private-doc"] }).citations).toEqual([]);
    expect(rag.retrieveContext(provider.user_id, "机器学习", { mode: "sources", sourceIds: ["other-source"], documentIds: [] }).citations).toEqual([]);
    expect(rag.retrieveContext(provider.user_id, "机器学习", { mode: "none", sourceIds: [sourceId], documentIds: ["private-doc"] }).citations).toEqual([]);
  });

  it.each(["openai", "anthropic"] as const)("sends correct %s requests and parses split SSE chunks", async (protocol) => {
    const fetchMock = vi.fn(async (_url, options) => {
      const headers = options.headers as Record<string, string>;
      const body = JSON.parse(options.body as string);
      expect(protocol === "openai" ? headers.authorization : headers["x-api-key"]).toContain("private-model-key");
      expect(body.stream).toBe(true);
      expect(protocol === "openai" ? body.messages[0].content : body.system).toBe("trusted system");
      const data = protocol === "openai"
        ? 'data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n'
        : 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"回答"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
      const bytes = new TextEncoder().encode(data);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 17)); controller.enqueue(bytes.slice(17)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pieces: string[] = [];
    const text = await ai.streamChat({ provider: { ...provider, protocol }, system: "trusted system", messages: [{ role: "user", content: "question" }], onDelta: (delta) => pieces.push(delta) });
    expect(text).toBe("回答");
    expect(pieces).toEqual(["回答"]);
    expect(fetchMock.mock.calls[0][0]).toBe(protocol === "openai" ? "https://example.test/v1/chat/completions" : "https://example.test/v1/messages");
  });

  it("streams and persists an answer with document citations through the chat API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"梯度爆炸可通过梯度裁剪缓解 [1]。"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })));
    const created = await app.inject({ method: "POST", url: "/api/chat/sessions", headers: { cookie: ownerCookie }, payload: {
      providerId: provider.id, scope: { mode: "documents", documentIds: ["private-doc"] },
    } });
    const id = created.json().session.id;
    const response = await app.inject({ method: "POST", url: `/api/chat/sessions/${id}/messages`, headers: { cookie: ownerCookie }, payload: { content: "梯度爆炸如何缓解？" } });
    expect(response.statusCode).toBe(200);
    const events = response.body.split("\n\n").filter((part) => part.startsWith("data: ")).map((part) => JSON.parse(part.slice(6)));
    expect(events.find((event) => event.type === "citations").citations[0].documentId).toBe("private-doc");
    expect(events.find((event) => event.type === "done").message.content).toContain("梯度裁剪");
    const history = await app.inject({ url: `/api/chat/sessions/${id}`, headers: { cookie: ownerCookie } });
    expect(history.json().messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
    expect(history.json().messages[1].citations[0].documentId).toBe("private-doc");
  });
});
