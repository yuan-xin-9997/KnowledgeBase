import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { parseBody, parseQuery, sendError } from "../util.js";
import { API_SCOPES, audit, createApiCredential, listApiCredentials, revokeApiCredential } from "../services/api-access.js";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1).transform((items) => [...new Set(items)]),
  expiresAt: z.iso.datetime().nullable().optional(),
});

export default async function apiCredentialRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/api-credentials", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    try {
      const query = parseQuery(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }), request);
      reply.send({ credentials: listApiCredentials(user.id, query.page, query.pageSize), availableScopes: API_SCOPES });
    } catch (error) { sendError(reply, error); }
  });

  app.post("/api/api-credentials", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    try {
      const created = createApiCredential(user.id, parseBody(createSchema, request));
      audit({ userId: user.id, channel: "web", action: "credential.create", targetType: "api_credential", targetId: created.id, result: "success" });
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache").code(201).send({ credential: created, warning: "令牌只显示一次，请立即保存" });
    } catch (error) {
      audit({ userId: user.id, channel: "web", action: "credential.create", targetType: "api_credential", result: "failure" });
      sendError(reply, error);
    }
  });

  app.delete("/api/api-credentials/:id", async (request, reply) => {
    const user = requireUser(request, reply); if (!user) return;
    if (request.apiCredential) return reply.code(403).send({ error: "访问令牌只能通过网页登录管理" });
    try {
      const id = (request.params as { id: string }).id;
      revokeApiCredential(user.id, id);
      audit({ userId: user.id, channel: "web", action: "credential.revoke", targetType: "api_credential", targetId: id, result: "success" });
      reply.send({ ok: true });
    } catch (error) {
      audit({ userId: user.id, channel: "web", action: "credential.revoke", targetType: "api_credential", targetId: (request.params as { id: string }).id, result: "failure" });
      sendError(reply, error);
    }
  });
}
