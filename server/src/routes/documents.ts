import { markdownImages, sourceDocumentPath } from "../services/document-images.js";
import { getSourceRow, sourceConfig } from "../services/sources.js";
import { parseLocalConfig } from "../connectors/local.js";
import { createClient, parseSmbConfig } from "../connectors/smb.js";
import { documentFolder } from "../services/search.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { parseQuery, sendError, searchDate } from "../util.js";
import { removeFromIndex, searchDocuments } from "../services/search.js";
import type { DocumentRow } from "../types.js";

const listSchema = z.object({
  q: z.string().trim().max(500).optional(),
  mode: z.enum(["all", "title", "content", "attachment"]).optional(),
  sourceId: z.string().optional(),
  folder: z.string().max(4096).optional(),
  kind: z.string().optional(),
  tag: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(["relevance", "newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function tagsOf(documentId: string): string[] {
  return (
    db
      .prepare("SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag")
      .all(documentId) as Array<{ tag: string }>
  ).map((row) => row.tag);
}

export default async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/documents", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const query = parseQuery(listSchema, request);
      const result = searchDocuments({
        userId: user.id,
        query: query.q,
        mode: query.mode,
        sourceId: query.sourceId,
        folder: query.folder,
        kind: query.kind,
        tag: query.tag,
        from: searchDate(query.from),
        to: searchDate(query.to, true),
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      });
      reply.send(result);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/documents/folders", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { sourceId } = parseQuery(z.object({ sourceId: z.string() }), request);
    const rows = db.prepare("SELECT metadata, external_id, kind FROM documents WHERE user_id = ? AND source_id = ? AND deleted_at IS NULL")
      .all(user.id, sourceId) as Array<{ metadata: string | null; external_id: string; kind: string }>;
    const folders = new Set<string>();
    for (const row of rows) {
      const parts = documentFolder(row.metadata, row.external_id, row.kind).split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    return { folders: [...folders].sort((a, b) => a.localeCompare(b)) };
  });

  app.get("/api/documents/:id/image", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const { src } = parseQuery(z.object({ src: z.string().min(1).max(4096) }), request);
      const row = db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, user.id) as DocumentRow | undefined;
      if (!row) return reply.code(404).send({ error: "文档不存在" });
      const source = getSourceRow(user.id, row.source_id);
      const reference = decodeURIComponent(src.split(/[?#]/)[0]).replace(/\\/g, "/");
      if (/^[a-z][a-z0-9+.-]*:|^\/\/|\x00/i.test(reference)) return reply.code(400).send({ error: "无效图片路径" });
      const documentPath = sourceDocumentPath(row.external_id, source.type === "smb" ? parseSmbConfig(sourceConfig(source)).basePath : "");
      const relative = path.posix.normalize(reference.startsWith("/") ? reference.slice(1) : path.posix.join(path.posix.dirname(documentPath), reference));
      if (relative === ".." || relative.startsWith("../")) return reply.code(403).send({ error: "图片超出来源目录" });
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' } as Record<string, string>)[path.posix.extname(relative).toLowerCase()];
      if (!mime) return reply.code(400).send({ error: "不支持的图片类型" });
      let buffer: Buffer;
      if (source.type === "local") {
        const root = await fs.promises.realpath(parseLocalConfig(sourceConfig(source)).path);
        const target = await fs.promises.realpath(path.resolve(root, relative));
        const inside = path.relative(root, target);
        if (path.isAbsolute(inside) || inside === ".." || inside.startsWith(".." + path.sep)) return reply.code(403).send({ error: "图片超出来源目录" });
        if ((await fs.promises.stat(target)).size > 20 * 1024 * 1024) return reply.code(413).send({ error: "图片超过20MB" });
        buffer = await fs.promises.readFile(target);
      } else if (source.type === "smb") {
        const settings = parseSmbConfig(sourceConfig(source));
        const client = createClient({ ...settings, maxFileSizeMb: 20 });
        try { buffer = await client.readFile(path.posix.join(settings.basePath.replace(/\\/g, "/"), relative).replace(/\//g, "\\")); }
        finally { client.disconnect(); }
      } else return reply.code(404).send({ error: "来源不支持本地图片" });
      return reply.header("Content-Type", mime).header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox").header("Cache-Control", "private, max-age=300").send(buffer);
    } catch { return reply.code(404).send({ error: "图片当前不可访问" }); }
  });

  app.get("/api/documents/picker", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const query = parseQuery(
        z.object({
          q: z.string().trim().max(300).optional(),
          sourceId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        request,
      );
      const result = searchDocuments({
        userId: user.id,
        query: query.q,
        sourceId: query.sourceId,
        pageSize: query.limit ?? 30,
      });
      reply.send({
        items: result.items.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          date: item.publishedAt || item.sourceCreatedAt,
        })),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/documents/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = db
      .prepare(
        `SELECT d.*, s.name AS source_name, s.type AS source_type
         FROM documents d JOIN sources s ON s.id = d.source_id
         WHERE d.id = ? AND d.user_id = ?`,
      )
      .get(id, user.id) as (DocumentRow & { source_name: string; source_type: string }) | undefined;
    if (!row || row.deleted_at) {
      reply.code(404).send({ error: "文档不存在" });
      return;
    }
    let metadata: unknown = null;
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : null;
    } catch {
      metadata = null;
    }
    reply.send({
      document: {
        id: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        sourceType: row.source_type,
        externalId: row.external_id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        author: row.author,
        url: row.url,
        mimeType: row.mime_type,
        size: row.size,
        content: row.content_format === "markdown" && row.content ? markdownImages(row.content) : row.content,
        contentFormat: row.content_format,
        language: row.language,
        publishedAt: row.published_at,
        sourceCreatedAt: row.source_created_at,
        sourceUpdatedAt: row.source_updated_at,
        filePath: row.file_path,
        metadata,
        tags: tagsOf(row.id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        fileAvailable: Boolean(row.file_path && fs.existsSync(row.file_path)),
      },
    });
  });

  app.get("/api/documents/:id/file", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = db
      .prepare("SELECT * FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
      .get(id, user.id) as DocumentRow | undefined;
    if (!row) {
      reply.code(404).send({ error: "文档不存在" });
      return;
    }
    if (!row.file_path) {
      reply.code(404).send({ error: "该文档没有可下载的原始文件" });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(row.file_path);
    } catch {
      reply.code(404).send({ error: "原始文件当前不可访问" });
      return;
    }
    if (!stat.isFile()) {
      reply.code(404).send({ error: "原始文件当前不可访问" });
      return;
    }
    const cacheRelative = path.relative(path.resolve(config.dataDir, "attachments"), path.resolve(row.file_path));
    const cached = cacheRelative !== "" && !path.isAbsolute(cacheRelative) && !cacheRelative.startsWith("..");
    const extension = path.extname(row.file_path);
    const title = row.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "附件";
    const fileName = cached ? `${title}${title.toLowerCase().endsWith(extension.toLowerCase()) ? "" : extension}` : path.basename(row.file_path);
    const range = request.headers.range;
    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", row.mime_type || "application/octet-stream");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "sandbox");
    reply.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const suffix = !match[1] && match[2] ? Number(match[2]) : null;
        const start = suffix !== null ? Math.max(0, stat.size - suffix) : Number(match[1] || 0);
        const end = suffix !== null ? stat.size - 1 : Math.min(Number(match[2] || stat.size - 1), stat.size - 1);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || stat.size === 0 || (suffix !== null && suffix <= 0) || start >= stat.size || end < start) {
          reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
          return;
        }
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        reply.header("Content-Length", end - start + 1);
        return reply.send(fs.createReadStream(row.file_path, { start, end }));
      }
    }
    reply.header("Content-Length", stat.size);
    return reply.send(fs.createReadStream(row.file_path));
  });

  app.delete("/api/documents/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const result = db
      .prepare("UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), id, user.id);
    if (result.changes === 0) {
      reply.code(404).send({ error: "文档不存在" });
      return;
    }
    removeFromIndex(id);
    reply.send({ ok: true });
  });
}
