import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { parseBody, sendError } from "../util.js";
import { API_SCOPES, createApiCredential, listApiCredentials, revokeApiCredential } from "../services/api-access.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1).transform((items) => [...new Set(items)]),
  expiresAt: z.iso.datetime().nullable().optional(),
});

export default async function apiCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/api-credentials", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    reply.send({ credentials: listApiCredentials(user.id), availableScopes: API_SCOPES });
  });

  app.post("/api/api-credentials", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    try {
      const created = createApiCredential(user.id, parseBody(createSchema, request));
      reply.code(201).send({ credential: created, warning: "令牌只显示一次，请立即保存" });
    } catch (error) { sendError(reply, error); }
  });

  app.delete("/api/api-credentials/:id", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    try {
      revokeApiCredential(user.id, (request.params as { id: string }).id);
      reply.send({ ok: true });
    } catch (error) { sendError(reply, error); }
  });
}
