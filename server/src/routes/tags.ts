import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { sendError } from "../util.js";

export default async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tags", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const rows = db
        .prepare(
          `SELECT dt.tag, COUNT(*) AS count
           FROM document_tags dt
           JOIN documents d ON d.id = dt.document_id
           WHERE d.user_id = ? AND d.deleted_at IS NULL
           GROUP BY dt.tag ORDER BY count DESC, dt.tag ASC`,
        )
        .all(user.id) as Array<{ tag: string; count: number }>;
      reply.send({ tags: rows });
    } catch (error) {
      sendError(reply, error);
    }
  });
}
