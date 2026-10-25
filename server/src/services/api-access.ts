import { createHash } from "node:crypto";
import { db, newId, nowIso } from "../db.js";
import { randomToken, sha256 } from "../crypto.js";
import { HttpError } from "../util.js";

export const API_SCOPES = [
  "documents:read",
  "sources:read",
  "sources:write",
  "sync:write",
  "jobs:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function createApiCredential(userId: string, input: {
  name: string; scopes: ApiScope[]; expiresAt?: string | null;
}): { id: string; token: string; createdAt: string; expiresAt: string | null; scopes: ApiScope[] } {
  const id = newId("key");
  const token = `kb_${randomToken(32)}`;
  const createdAt = nowIso();
  const expiresAt = input.expiresAt || null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new HttpError(400, "过期时间必须晚于当前时间");
  }
  db.prepare(
    `INSERT INTO api_credentials(id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.name, sha256(token), token.slice(0, 11), JSON.stringify(input.scopes), expiresAt, createdAt);
  return { id, token, createdAt, expiresAt, scopes: input.scopes };
}

export function listApiCredentials(userId: string, page: number, pageSize: number): { items: unknown[]; total: number; page: number; pageSize: number } {
  const rows = db.prepare(
    `SELECT id, name, token_prefix, scopes, expires_at, revoked_at, last_used_at, created_at
     FROM api_credentials WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(userId, pageSize, (page - 1) * pageSize) as Array<Record<string, string | null>>;
  const total = (db.prepare("SELECT COUNT(*) AS count FROM api_credentials WHERE user_id = ?").get(userId) as { count: number }).count;
  const items = rows.map((row) => ({
    id: row.id, name: row.name, tokenPrefix: row.token_prefix,
    scopes: JSON.parse(row.scopes || "[]"), expiresAt: row.expires_at,
    revokedAt: row.revoked_at, lastUsedAt: row.last_used_at, createdAt: row.created_at,
    status: row.revoked_at ? "revoked" : row.expires_at && row.expires_at <= nowIso() ? "expired" : "active",
  }));
  return { items, total, page, pageSize };
}

export function revokeApiCredential(userId: string, id: string): void {
  const result = db.prepare(
    "UPDATE api_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?",
  ).run(nowIso(), id, userId);
  if (!result.changes) throw new HttpError(404, "访问令牌不存在");
}

export function persistOAuthAccessToken(credentialId: string, allowedScopes: string[], requestedScopes?: string) {
  const requested = requestedScopes?.trim() ? requestedScopes.trim().split(/\s+/) : allowedScopes;
  if (requested.some((scope) => !allowedScopes.includes(scope))) throw new HttpError(400, "请求了未授权的 scope");
  const token = `mcp_${randomToken(32)}`, expiresIn = 3600;
  db.prepare("DELETE FROM oauth_access_tokens WHERE expires_at <= ?").run(nowIso());
  db.prepare(
    "INSERT INTO oauth_access_tokens(id, credential_id, token_hash, scopes, expires_at, created_at) VALUES(?, ?, ?, ?, ?, ?)",
  ).run(newId("oat"), credentialId, sha256(token), JSON.stringify(requested), new Date(Date.now() + expiresIn * 1000).toISOString(), nowIso());
  return { accessToken: token, scopes: requested, expiresIn };
}

export function audit(input: {
  userId: string; credentialId?: string | null; channel: "api" | "mcp" | "web";
  action: string; targetType: string; targetId?: string | null; result: "success" | "failure";
}): void {
  db.prepare(
    `INSERT INTO audit_logs(id, user_id, credential_id, channel, action, target_type, target_id, result, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("audit"), input.userId, input.credentialId || null, input.channel,
    input.action, input.targetType, input.targetId || null, input.result, nowIso());
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? {})).digest("hex");
}

export function getIdempotentResponse(credentialId: string, route: string, key: string, hash: string): { statusCode: number; body: unknown } | null {
  const row = db.prepare(
    `SELECT request_hash, status_code, response FROM idempotency_records
     WHERE credential_id = ? AND route = ? AND idempotency_key = ?`,
  ).get(credentialId, route, key) as { request_hash: string; status_code: number; response: string } | undefined;
  if (!row) return null;
  if (row.request_hash !== hash) throw new HttpError(409, "同一 Idempotency-Key 不可用于不同请求");
  return { statusCode: row.status_code, body: JSON.parse(row.response) };
}

export function saveIdempotentResponse(credentialId: string, route: string, key: string, hash: string, statusCode: number, body: unknown): void {
  db.prepare(
    `INSERT INTO idempotency_records(credential_id, route, idempotency_key, request_hash, status_code, response, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
  ).run(credentialId, route, key, hash, statusCode, JSON.stringify(body), nowIso());
}
