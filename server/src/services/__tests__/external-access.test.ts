import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

let tempDir: string;
let app: FastifyInstance;
let db: typeof import("../../db.js").db;
let token: string;
let credentialId: string;
let readOnlyToken: string;
let sourceId: string;
let baseUrl: string;
let browserCookie: string;
let otherCookie: string;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-external-"));
  process.env.DATA_DIR = tempDir;
  process.env.SYNC_SCHEDULER = "false";
  const dbModule = await import("../../db.js"); db = dbModule.db;
  const auth = await import("../../auth.js");
  const access = await import("../api-access.js");
  const sources = await import("../sources.js");
  const { registerMcp } = await import("../../mcp.js");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users(id,email,username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?,?,?)")
    .run("external-user", "external@test.local", "external", "x", "External", "admin", now);
  db.prepare("INSERT INTO users(id,email,username,password_hash,display_name,role,created_at) VALUES(?,?,?,?,?,?,?)")
    .run("other-user", "other@test.local", "other", "x", "Other", "user", now);
  browserCookie = `kb_session=${auth.createSession("external-user").token}`;
  otherCookie = `kb_session=${auth.createSession("other-user").token}`;
  sourceId = sources.createSource("external-user", { name: "Automation source", type: "local", config: { path: tempDir }, enabled: false }).id;
  const full = access.createApiCredential("external-user", { name: "test-full", scopes: [...access.API_SCOPES] });
  token = full.token; credentialId = full.id;
  readOnlyToken = access.createApiCredential("external-user", { name: "test-read", scopes: ["documents:read"] }).token;
  db.prepare("INSERT INTO api_credentials(id,user_id,name,token_hash,token_prefix,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("expired-key", "external-user", "expired", (await import("../../crypto.js")).sha256("kb_expired_test"), "kb_expired", JSON.stringify(["documents:read"]), "2020-01-01T00:00:00.000Z", now);

  app = Fastify(); await app.register(cookie); await app.register(formbody);
  app.decorateRequest("user", null); app.decorateRequest("apiCredential", null);
  app.addHook("onRequest", async (request) => { request.user = auth.userFromRequest(request); request.apiCredential = auth.apiCredentialFromRequest(request); });
  await app.register((await import("../../routes/api-v1.js")).default);
  await app.register((await import("../../routes/api-credentials.js")).default);
  await registerMcp(app);
  const { HttpError } = await import("../../util.js");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: "TEST", message: error.message } });
    return reply.code(500).send({ error: String(error) });
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 30_000);

afterAll(async () => { await app?.close(); db?.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

describe("versioned API authentication and safety", () => {
  it("accepts a valid token and rejects missing, wrong, expired and under-scoped tokens", async () => {
    expect((await app.inject("/api/v1/documents")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/documents", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/documents", headers: { authorization: "Bearer kb_expired_test" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/sources", headers: { authorization: `Bearer ${readOnlyToken}` } })).statusCode).toBe(403);
    const ok = await app.inject({ url: "/api/v1/sources", headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(200); expect(ok.json().sources[0].id).toBe(sourceId);
  });

  it("requires and replays idempotency keys without repeating writes", async () => {
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": "update-source-test-1" };
    const first = await app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers, payload: { name: "Updated once" } });
    const second = await app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers, payload: { name: "Updated once" } });
    expect(first.statusCode).toBe(200); expect(second.json()).toEqual(first.json());
    expect((db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='source.update'").get() as { count: number }).count).toBe(1);
    expect((await app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers: { authorization: `Bearer ${token}` }, payload: { name: "No key" } })).statusCode).toBe(400);
  });

  it("serializes concurrent duplicate writes and rejects key reuse with another payload", async () => {
    const headers = { authorization: `Bearer ${token}`, "idempotency-key": "concurrent-update-test-1" };
    const requests = await Promise.all(Array.from({ length: 6 }, () => app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers, payload: { name: "Concurrent once" } })));
    expect(requests.every((response) => response.statusCode === 200)).toBe(true);
    expect(new Set(requests.map((response) => response.body)).size).toBe(1);
    const conflict = await app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers, payload: { name: "Different payload" } });
    expect(conflict.statusCode).toBe(409);
  });

  it("issues short-lived OAuth access tokens through client_credentials", async () => {
    const response = await app.inject({ method: "POST", url: "/oauth/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `grant_type=client_credentials&client_id=${credentialId}&client_secret=${encodeURIComponent(token)}&scope=sources%3Aread` });
    expect(response.statusCode).toBe(200);
    const oauthToken = response.json().access_token as string;
    expect(oauthToken).toMatch(/^mcp_/);
    expect((await app.inject({ url: "/api/v1/sources", headers: { authorization: `Bearer ${oauthToken}` } })).statusCode).toBe(200);
  });
});

describe("browser credential management", () => {
  it("creates a one-time secret, paginates metadata, isolates owners and audits writes", async () => {
    const created = await app.inject({ method: "POST", url: "/api/api-credentials", headers: { cookie: browserCookie }, payload: { name: "browser-created", scopes: ["documents:read"], expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    expect(created.statusCode).toBe(201); expect(created.headers["cache-control"]).toBe("no-store");
    const secret = created.json().credential.token as string; expect(secret).toMatch(/^kb_/);
    const list = await app.inject({ url: "/api/api-credentials?page=1&pageSize=2", headers: { cookie: browserCookie } });
    expect(list.statusCode).toBe(200); expect(list.json().credentials.items).toHaveLength(2);
    expect(list.body).not.toContain(secret); expect(list.json().credentials.total).toBeGreaterThan(2);
    const id = created.json().credential.id as string;
    expect((await app.inject({ method: "DELETE", url: `/api/api-credentials/${id}`, headers: { cookie: otherCookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/api-credentials/${id}`, headers: { cookie: browserCookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/documents", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(401);
    const actions = db.prepare("SELECT action,result FROM audit_logs WHERE target_id = ? ORDER BY created_at").all(id) as Array<{ action: string; result: string }>;
    expect(actions).toEqual(expect.arrayContaining([{ action: "credential.create", result: "success" }, { action: "credential.revoke", result: "success" }]));
  });

  it("rejects forged scopes and bearer-based credential administration", async () => {
    expect((await app.inject({ method: "POST", url: "/api/api-credentials", headers: { cookie: browserCookie }, payload: { name: "forged", scopes: ["admin:all"] } })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/api-credentials", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
  });
});

describe("current user authority", () => {
  it("immediately applies role downgrade and account disablement to existing credentials", async () => {
    db.prepare("UPDATE users SET role='user' WHERE id='external-user'").run();
    const downgraded = await app.inject({ method: "PATCH", url: `/api/v1/sources/${sourceId}`, headers: { authorization: `Bearer ${token}`, "idempotency-key": "role-downgrade-test" }, payload: { name: "Must not change" } });
    expect(downgraded.statusCode).toBe(403);
    db.prepare("UPDATE users SET role='admin', active=0 WHERE id='external-user'").run();
    expect((await app.inject({ url: "/api/v1/documents", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/api-credentials", headers: { cookie: browserCookie } })).statusCode).toBe(401);
    db.prepare("UPDATE users SET active=1 WHERE id='external-user'").run();
  });
});

describe("official MCP client", () => {
  it("initializes, lists tools, reads and performs a confirmed safe write", async () => {
    const client = new Client({ name: "knowledge-base-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: { token: async () => token } });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_sources");
    const read = await client.callTool({ name: "list_sources", arguments: {} });
    expect(JSON.stringify(read.content)).toContain(sourceId);
    const write = await client.callTool({ name: "update_source", arguments: { id: sourceId, enabled: false, idempotencyKey: "mcp-safe-write-1", confirm: true } });
    expect(write.isError).not.toBe(true);
    await client.close();
  });
});

describe("restart recovery", () => {
  it("marks interrupted jobs failed with a reason", async () => {
    const now = new Date().toISOString();
    db.prepare("INSERT INTO sync_jobs(id,source_id,user_id,status,created_at) VALUES(?,?,?,?,?)").run("restart-job", sourceId, "external-user", "running", now);
    (await import("../sync.js")).cleanupInterruptedJobs();
    const job = db.prepare("SELECT status,error FROM sync_jobs WHERE id='restart-job'").get() as { status: string; error: string };
    expect(job.status).toBe("error"); expect(job.error).toContain("服务重启");
  });
});
