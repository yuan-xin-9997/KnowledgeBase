import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, nowIso } from "../db.js";
import { requireUser } from "../auth.js";
import { badRequest, parseBody, parseQuery, sendError } from "../util.js";
import {
  createSource,
  deleteSource,
  getSourceRow,
  publicSource,
  testSourceConfig,
  updateSource,
} from "../services/sources.js";
import { getJob, isSourceSyncing, startSync } from "../services/sync.js";
import { listConnectors } from "../connectors/index.js";

const sourceSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100),
  type: z.enum(["local", "smb", "cubox", "yuque"]),
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
});

export default async function sourceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/source-types", async (_request, reply) => {
    reply.send({
      types: listConnectors().map((connector) => ({
        type: connector.type,
        label: connector.label,
        description: connector.description,
      })),
    });
  });

  app.get("/api/sources", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const rows = db
        .prepare("SELECT * FROM sources WHERE user_id = ? ORDER BY created_at")
        .all(user.id);
      reply.send({ sources: rows.map((row) => publicSource(row as never)) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/sources/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      reply.send({ source: publicSource(getSourceRow(user.id, id)) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/sources", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const body = parseBody(sourceSchema, request);
      const row = createSource(user.id, body);
      reply.code(201).send({ source: publicSource(row) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch("/api/sources/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const body = parseBody(sourceSchema.partial(), request);
      const row = updateSource(user.id, id, body);
      reply.send({ source: publicSource(row) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/sources/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      deleteSource(user.id, id);
      reply.send({ ok: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/sources/test", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const body = parseBody(
        z.object({
          type: z.enum(["local", "smb", "cubox", "yuque"]),
          config: z.record(z.string(), z.unknown()).default({}),
          sourceId: z.string().optional(),
        }),
        request,
      );
      const result = await testSourceConfig(user.id, body.type, body.config, body.sourceId);
      reply.send(result);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/sources/:id/test", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const row = getSourceRow(user.id, id);
      const result = await testSourceConfig(user.id, row.type, {}, id);
      reply.send(result);
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/sources/:id/sync", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      getSourceRow(user.id, id);
      if (isSourceSyncing(id)) {
        reply.code(409).send({ error: "该信息来源正在同步中" });
        return;
      }
      const body = parseBody(z.object({ force: z.boolean().optional() }).default({}), request);
      const job = startSync(user.id, id, { force: body.force });
      reply.code(202).send({
        job: {
          id: job.id,
          status: job.status,
          createdAt: job.created_at,
        },
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/sources/:id/cancel", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      getSourceRow(user.id, id);
      const { cancelSourceSync } = await import("../services/sync.js");
      reply.send({ ok: cancelSourceSync(id) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/sources/:id/jobs", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      getSourceRow(user.id, id);
      const query = parseQuery(
        z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
        request,
      );
      const rows = db
        .prepare(
          "SELECT * FROM sync_jobs WHERE source_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(id, user.id, query.limit) as Array<{
        id: string;
        status: string;
        stats: string | null;
        error: string | null;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
      }>;
      reply.send({
        jobs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          stats: row.stats ? JSON.parse(row.stats) : null,
          error: row.error,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/sync-jobs/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const job = getJob(user.id, id);
      reply.send({
        job: {
          id: job.id,
          sourceId: job.source_id,
          status: job.status,
          stats: job.stats ? JSON.parse(job.stats) : null,
          error: job.error,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
          createdAt: job.created_at,
        },
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/sync-jobs", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const rows = db
        .prepare(
          `SELECT j.*, s.name AS source_name FROM sync_jobs j
           JOIN sources s ON s.id = j.source_id
           WHERE j.user_id = ? ORDER BY j.created_at DESC LIMIT 30`,
        )
        .all(user.id) as Array<{
        id: string;
        source_id: string;
        source_name: string;
        status: string;
        stats: string | null;
        error: string | null;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
      }>;
      reply.send({
        jobs: rows.map((row) => ({
          id: row.id,
          sourceId: row.source_id,
          sourceName: row.source_name,
          status: row.status,
          stats: row.stats ? JSON.parse(row.stats) : null,
          error: row.error,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/sources/:id/preview", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const row = getSourceRow(user.id, id);
      if (row.type === "local" || row.type === "smb") badRequest("该类型暂不支持预览");
      reply.send({ preview: [] });
    } catch (error) {
      sendError(reply, error);
    }
  });
}

export { nowIso };
