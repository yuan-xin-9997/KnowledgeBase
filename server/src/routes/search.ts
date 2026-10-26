import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { parseQuery, sendError, searchDate } from "../util.js";
import { searchDocuments } from "../services/search.js";

const schema = z.object({
  q: z.string().trim().max(500).optional(),
  mode: z.enum(["all", "title", "content", "attachment"]).optional(),
  sourceId: z.string().optional(),
  folder: z.string().max(4096).optional(),
  deduplicate: z.enum(["true", "false"]).transform(value => value === "true").optional(),
  kind: z.string().optional(),
  tag: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(["relevance", "newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export default async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/search", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const query = parseQuery(schema, request);
      const result = searchDocuments({
        userId: user.id,
        query: query.q,
        mode: query.mode,
        sourceId: query.sourceId,
        folder: query.folder,
        deduplicate: query.deduplicate,
        kind: query.kind,
        tag: query.tag,
        from: searchDate(query.from),
        to: searchDate(query.to, true),
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      });

      const facetRows = db
        .prepare(
          `SELECT s.id, s.name, COUNT(d.id) AS count
           FROM sources s LEFT JOIN documents d
             ON d.source_id = s.id AND d.deleted_at IS NULL
           WHERE s.user_id = ? GROUP BY s.id ORDER BY s.name`,
        )
        .all(user.id) as Array<{ id: string; name: string; count: number }>;

      reply.send({
        ...result,
        facets: {
          sources: facetRows.map((row) => ({ id: row.id, name: row.name, count: row.count })),
        },
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/search/suggest", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { q } = parseQuery(z.object({ q: z.string().trim().max(120).default("") }), request);
    if (!q) {
      reply.send({ items: [] });
      return;
    }
    const result = searchDocuments({ userId: user.id, query: q, pageSize: 8 });
    reply.send({
      items: result.items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        sourceName: item.sourceName,
      })),
    });
  });
}
