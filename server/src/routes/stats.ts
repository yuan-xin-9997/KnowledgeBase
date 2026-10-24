import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { sendError } from "../util.js";

export default async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const documents = (
        db
          .prepare("SELECT COUNT(*) AS count FROM documents WHERE user_id = ? AND deleted_at IS NULL")
          .get(user.id) as { count: number }
      ).count;
      const sources = (
        db.prepare("SELECT COUNT(*) AS count FROM sources WHERE user_id = ?").get(user.id) as {
          count: number;
        }
      ).count;
      const tags = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT dt.tag) AS count FROM document_tags dt
             JOIN documents d ON d.id = dt.document_id
             WHERE d.user_id = ? AND d.deleted_at IS NULL`,
          )
          .get(user.id) as { count: number }
      ).count;
      const totalSize = (
        db
          .prepare(
            "SELECT COALESCE(SUM(size), 0) AS total FROM documents WHERE user_id = ? AND deleted_at IS NULL",
          )
          .get(user.id) as { total: number }
      ).total;

      const bySource = db
        .prepare(
          `SELECT s.id, s.name, s.type, s.last_sync_at, s.last_sync_status,
                  COUNT(d.id) AS doc_count
           FROM sources s LEFT JOIN documents d
             ON d.source_id = s.id AND d.deleted_at IS NULL
           WHERE s.user_id = ? GROUP BY s.id ORDER BY doc_count DESC`,
        )
        .all(user.id);

      const byKind = db
        .prepare(
          `SELECT kind, COUNT(*) AS count FROM documents
           WHERE user_id = ? AND deleted_at IS NULL GROUP BY kind ORDER BY count DESC`,
        )
        .all(user.id);

      const recent = db
        .prepare(
          `SELECT d.id, d.title, d.kind, d.source_id, s.name AS source_name,
                  COALESCE(d.published_at, d.source_created_at, d.created_at) AS date
           FROM documents d JOIN sources s ON s.id = d.source_id
           WHERE d.user_id = ? AND d.deleted_at IS NULL
           ORDER BY date DESC LIMIT 8`,
        )
        .all(user.id);

      const activeSyncs = db
        .prepare(
          `SELECT j.id, j.source_id, j.status, j.started_at, s.name AS source_name
           FROM sync_jobs j JOIN sources s ON s.id = j.source_id
           WHERE j.user_id = ? AND j.status IN ('queued', 'running')
           ORDER BY j.created_at DESC LIMIT 10`,
        )
        .all(user.id);

      reply.send({
        stats: { documents, sources, tags, totalSize },
        bySource,
        byKind,
        recent,
        activeSyncs,
      });
    } catch (error) {
      sendError(reply, error);
    }
  });
}
