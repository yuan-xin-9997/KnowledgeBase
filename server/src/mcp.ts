import type { FastifyInstance, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { authenticateApiToken } from "./auth.js";
import { audit, getIdempotentResponse, persistOAuthAccessToken, requestHash, saveIdempotentResponse } from "./services/api-access.js";
import { createExternalSource, getDocument, getExternalJob, listDocuments, listSources, startExternalSync, updateExternalSource } from "./services/external-access.js";

type Context = { userId: string; credentialId: string; scopes: string[] };
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> });
const denied = (scope: string) => ({ content: [{ type: "text" as const, text: `缺少权限：${scope}` }], isError: true });

function buildServer(ctx: Context): McpServer {
  const server = new McpServer({ name: "zhiyu-knowledge-base", version: "1.1.0" }, {
    instructions: "访问当前用户的知屿知识库。写入工具必须显式传 confirm=true，并提供幂等键。",
  });
  server.registerTool("search_documents", {
    description: "分页检索当前用户有权访问的知识库文档。",
    inputSchema: z.object({ q: z.string().max(500).optional(), sourceId: z.string().optional(), tag: z.string().optional(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => ctx.scopes.includes("documents:read") ? json(listDocuments(ctx.userId, input)) : denied("documents:read"));
  server.registerTool("get_document", {
    description: "按 ID 获取一篇知识库文档的元数据、标签与正文。",
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => ctx.scopes.includes("documents:read") ? json({ document: getDocument(ctx.userId, id) }) : denied("documents:read"));
  server.registerTool("list_sources", {
    description: "列出当前用户的信息来源；敏感配置只返回掩码。",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => ctx.scopes.includes("sources:read") ? json({ sources: listSources(ctx.userId) }) : denied("sources:read"));
  server.registerTool("get_sync_job", {
    description: "查询同步任务状态、进度统计、结果或失败原因。",
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ id }) => ctx.scopes.includes("jobs:read") ? json({ job: getExternalJob(ctx.userId, id) }) : denied("jobs:read"));
  server.registerTool("create_source", {
    description: "创建信息来源。必须显式确认；密钥只用于保存，不会写入审计日志。",
    inputSchema: z.object({ name: z.string().min(1).max(100), type: z.enum(["local", "smb", "cubox", "yuque"]), config: z.record(z.string(), z.unknown()).default({}), enabled: z.boolean().optional(), syncIntervalMinutes: z.number().int().min(0).max(43200).optional(), idempotencyKey: z.string().min(8).max(128), confirm: z.literal(true) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (!ctx.scopes.includes("sources:write")) return denied("sources:write");
    const { idempotencyKey, confirm: _confirm, ...payload } = input;
    const route = "mcp:create_source", hash = requestHash(payload);
    const old = getIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash); if (old) return json(old.body);
    try { const body = { source: createExternalSource(ctx.userId, payload) }; saveIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash, 200, body); audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.create", targetType: "source", targetId: body.source.id, result: "success" }); return json(body); }
    catch (error) { audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.create", targetType: "source", result: "failure" }); throw error; }
  });
  server.registerTool("update_source", {
    description: "修改已有信息来源。必须显式确认，重复幂等键不会重复修改。",
    inputSchema: z.object({ id: z.string().min(1), name: z.string().min(1).max(100).optional(), config: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), syncIntervalMinutes: z.number().int().min(0).max(43200).optional(), idempotencyKey: z.string().min(8).max(128), confirm: z.literal(true) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    if (!ctx.scopes.includes("sources:write")) return denied("sources:write");
    const { id, idempotencyKey, confirm: _confirm, ...payload } = input, route = `mcp:update_source:${id}`, hash = requestHash(payload);
    const old = getIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash); if (old) return json(old.body);
    try { const body = { source: updateExternalSource(ctx.userId, id, payload) }; saveIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash, 200, body); audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.update", targetType: "source", targetId: id, result: "success" }); return json(body); }
    catch (error) { audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.update", targetType: "source", targetId: id, result: "failure" }); throw error; }
  });
  server.registerTool("start_source_sync", {
    description: "异步启动来源同步并返回任务 ID。必须显式确认，可用幂等键安全重试。",
    inputSchema: z.object({ sourceId: z.string().min(1), force: z.boolean().default(false), idempotencyKey: z.string().min(8).max(128), confirm: z.literal(true) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ sourceId, force, idempotencyKey }) => {
    if (!ctx.scopes.includes("sync:write")) return denied("sync:write");
    const route = `mcp:start_source_sync:${sourceId}`, hash = requestHash({ sourceId, force });
    const old = getIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash); if (old) return json(old.body);
    try { const body = { job: startExternalSync(ctx.userId, sourceId, force) }; saveIdempotentResponse(ctx.credentialId, route, idempotencyKey, hash, 200, body); audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.sync", targetType: "source", targetId: sourceId, result: "success" }); return json(body); }
    catch (error) { audit({ userId: ctx.userId, credentialId: ctx.credentialId, channel: "mcp", action: "source.sync", targetType: "source", targetId: sourceId, result: "failure" }); throw error; }
  });
  return server;
}

function unauthorized(request: FastifyRequest, reply: Parameters<FastifyInstance["post"]>[1] extends never ? never : any) {
  const proto = request.headers["x-forwarded-proto"] || request.protocol;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const metadata = `${proto}://${host}/.well-known/oauth-protected-resource/mcp`;
  reply.header("WWW-Authenticate", `Bearer resource_metadata="${metadata}"`).code(401).send({ error: "invalid_token", error_description: "需要有效且未过期的 Bearer 访问令牌" });
}

export async function registerMcp(app: FastifyInstance): Promise<void> {
  const resourceMetadata = async (request: FastifyRequest, reply: any) => {
    const proto = request.headers["x-forwarded-proto"] || request.protocol;
    const host = request.headers["x-forwarded-host"] || request.headers.host;
    reply.header("Access-Control-Allow-Origin", "*");
    return { resource: `${proto}://${host}/mcp`, authorization_servers: [`${proto}://${host}`], bearer_methods_supported: ["header"], scopes_supported: ["documents:read", "sources:read", "sources:write", "sync:write", "jobs:read"], resource_documentation: `${proto}://${host}/api/openapi.json` };
  };
  app.get("/.well-known/oauth-protected-resource", resourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", resourceMetadata);
  app.get("/.well-known/oauth-authorization-server", async (request) => {
    const proto = request.headers["x-forwarded-proto"] || request.protocol;
    const host = request.headers["x-forwarded-host"] || request.headers.host;
    return { issuer: `${proto}://${host}`, token_endpoint: `${proto}://${host}/oauth/token`, grant_types_supported: ["client_credentials"], token_endpoint_auth_methods_supported: ["client_secret_post"], scopes_supported: ["documents:read", "sources:read", "sources:write", "sync:write", "jobs:read"] };
  });
  app.post("/oauth/token", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    let clientId = typeof body?.client_id === "string" ? body.client_id : "";
    let clientSecret = typeof body?.client_secret === "string" ? body.client_secret : "";
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.authorization || "");
    if (basic) {
      const [id, ...secret] = Buffer.from(basic[1], "base64").toString("utf8").split(":");
      clientId = decodeURIComponent(id || ""); clientSecret = decodeURIComponent(secret.join(":"));
    }
    if (body?.grant_type !== "client_credentials" || !clientId || !clientSecret) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const authenticated = authenticateApiToken(clientSecret);
    if (!authenticated || authenticated.credential.id !== clientId) {
      return reply.code(401).header("WWW-Authenticate", "Basic").send({ error: "invalid_client" });
    }
    try {
      const issued = persistOAuthAccessToken(authenticated.credential.id, authenticated.credential.scopes, typeof body.scope === "string" ? body.scope : undefined);
      return reply.header("Cache-Control", "no-store").send({ access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, scope: issued.scopes.join(" ") });
    } catch { return reply.code(400).send({ error: "invalid_scope" }); }
  });
  app.post("/mcp", async (request, reply) => {
    if (!request.user || !request.apiCredential) return unauthorized(request, reply);
    const message = request.body as { method?: string; params?: { name?: string } } | null;
    const requiredByTool: Record<string, string> = { search_documents: "documents:read", get_document: "documents:read", list_sources: "sources:read", get_sync_job: "jobs:read", create_source: "sources:write", update_source: "sources:write", start_source_sync: "sync:write" };
    const required = message?.method === "tools/call" && message.params?.name ? requiredByTool[message.params.name] : undefined;
    if (required && !request.apiCredential.scopes.includes(required)) {
      return reply.header("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${required}"`).code(403).send({ error: "insufficient_scope", error_description: `缺少权限：${required}` });
    }
    const server = buildServer({ userId: request.user.id, credentialId: request.apiCredential.id, scopes: request.apiCredential.scopes });
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
  for (const method of ["GET", "DELETE"] as const) app.route({ method, url: "/mcp", handler: async (_request, reply) => reply.code(405).send({ error: "method_not_allowed" }) });
}
