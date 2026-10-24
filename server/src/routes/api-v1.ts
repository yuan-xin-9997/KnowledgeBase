import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireScope } from "../auth.js";
import { HttpError, parseBody, parseQuery } from "../util.js";
import { audit, getIdempotentResponse, requestHash, saveIdempotentResponse } from "../services/api-access.js";
import { createExternalSource, getDocument, getExternalJob, listDocuments, listSources, startExternalSync, updateExternalSource } from "../services/external-access.js";

const sourceInput = z.object({
  name: z.string().trim().min(1).max(100), type: z.enum(["local", "smb", "cubox", "yuque"]),
  config: z.record(z.string(), z.unknown()).default({}), enabled: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(0).max(43200).optional(),
});
const documentQuery = z.object({
  q: z.string().trim().max(500).optional(), sourceId: z.string().optional(), kind: z.string().optional(),
  tag: z.string().optional(), sort: z.enum(["relevance", "newest", "oldest"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function allowed(request: FastifyRequest, reply: Parameters<typeof requireScope>[1], scope: string): boolean {
  if (!request.user || !request.apiCredential) {
    reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "需要有效的 Bearer 访问令牌" } });
    return false;
  }
  return requireScope(request, reply, scope);
}

function writeAudit(request: FastifyRequest, action: string, targetType: string, targetId: string | null, result: "success" | "failure") {
  if (!request.user) return;
  audit({ userId: request.user.id, credentialId: request.apiCredential?.id, channel: "api", action, targetType, targetId, result });
}

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new HttpError(400, "写操作需要 8-128 位 Idempotency-Key 请求头");
  }
  return key;
}

export default async function apiV1Routes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/documents", async (request, reply) => {
    if (!allowed(request, reply, "documents:read")) return;
    reply.send(listDocuments(request.user!.id, parseQuery(documentQuery, request)));
  });
  app.get("/api/v1/documents/:id", async (request, reply) => {
    if (!allowed(request, reply, "documents:read")) return;
    reply.send({ document: getDocument(request.user!.id, (request.params as { id: string }).id) });
  });
  app.get("/api/v1/sources", async (request, reply) => {
    if (!allowed(request, reply, "sources:read")) return;
    reply.send({ sources: listSources(request.user!.id) });
  });
  app.post("/api/v1/sources", async (request, reply) => {
    if (!allowed(request, reply, "sources:write")) return;
    const key = idempotencyKey(request), hash = requestHash(request.body), route = "POST /api/v1/sources";
    const old = getIdempotentResponse(request.apiCredential!.id, route, key, hash);
    if (old) return reply.code(old.statusCode).send(old.body);
    try {
      const body = { source: createExternalSource(request.user!.id, parseBody(sourceInput, request)) };
      saveIdempotentResponse(request.apiCredential!.id, route, key, hash, 201, body);
      writeAudit(request, "source.create", "source", body.source.id, "success");
      reply.code(201).send(body);
    } catch (error) { writeAudit(request, "source.create", "source", null, "failure"); throw error; }
  });
  app.patch("/api/v1/sources/:id", async (request, reply) => {
    if (!allowed(request, reply, "sources:write")) return;
    const id = (request.params as { id: string }).id, key = idempotencyKey(request), hash = requestHash(request.body), route = `PATCH /api/v1/sources/${id}`;
    const old = getIdempotentResponse(request.apiCredential!.id, route, key, hash);
    if (old) return reply.code(old.statusCode).send(old.body);
    try {
      const parsed = parseBody(sourceInput.omit({ type: true }).partial(), request);
      const body = { source: updateExternalSource(request.user!.id, id, parsed) };
      saveIdempotentResponse(request.apiCredential!.id, route, key, hash, 200, body);
      writeAudit(request, "source.update", "source", id, "success"); reply.send(body);
    } catch (error) { writeAudit(request, "source.update", "source", id, "failure"); throw error; }
  });
  app.post("/api/v1/sources/:id/sync", async (request, reply) => {
    if (!allowed(request, reply, "sync:write")) return;
    const id = (request.params as { id: string }).id, key = idempotencyKey(request), hash = requestHash(request.body), route = `POST /api/v1/sources/${id}/sync`;
    const old = getIdempotentResponse(request.apiCredential!.id, route, key, hash);
    if (old) return reply.code(old.statusCode).send(old.body);
    try {
      const input = parseBody(z.object({ force: z.boolean().default(false) }).default({ force: false }), request);
      const body = { job: startExternalSync(request.user!.id, id, input.force) };
      saveIdempotentResponse(request.apiCredential!.id, route, key, hash, 202, body);
      writeAudit(request, "source.sync", "source", id, "success"); reply.code(202).send(body);
    } catch (error) { writeAudit(request, "source.sync", "source", id, "failure"); throw error; }
  });
  app.get("/api/v1/jobs/:id", async (request, reply) => {
    if (!allowed(request, reply, "jobs:read")) return;
    reply.send({ job: getExternalJob(request.user!.id, (request.params as { id: string }).id) });
  });
}
