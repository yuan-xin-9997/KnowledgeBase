import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, newId, nowIso } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { config } from "./config.js";
import type { ApiCredential, AuthUser, UserRole } from "./types.js";

export const SESSION_COOKIE = "kb_session";

interface UserRecord {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export function mapUser(row: UserRecord): AuthUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 11);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  db.prepare(
    "INSERT INTO sessions(id, user_id, token_hash, expires_at, created_at) VALUES(?, ?, ?, ?, ?)",
  ).run(newId("ses"), userId, sha256(token), expiresAt.toISOString(), nowIso());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function userFromRequest(request: FastifyRequest): AuthUser | null {
  const bearer = bearerFromRequest(request);
  if (bearer) return authenticateApiToken(bearer)?.user ?? null;
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowIso()) as UserRecord | undefined;
  if (row && (row as UserRecord & { active?: number }).active === 0) return null;
  return row ? mapUser(row) : null;
}

function bearerFromRequest(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() || null;
}

export function authenticateApiToken(token: string): { user: AuthUser; credential: ApiCredential } | null {
  if (!token.startsWith("kb_") && !token.startsWith("mcp_")) return null;
  const oauth = token.startsWith("mcp_");
  const row = db.prepare(
    `SELECT c.id AS credential_id, c.name, c.scopes, c.expires_at,
            ${oauth ? "t.scopes AS oauth_scopes," : ""} u.*
     FROM api_credentials c
     ${oauth ? "JOIN oauth_access_tokens t ON t.credential_id = c.id" : ""}
     JOIN users u ON u.id = c.user_id
     WHERE ${oauth ? "t.token_hash" : "c.token_hash"} = ? AND c.revoked_at IS NULL AND u.active = 1
       AND (c.expires_at IS NULL OR c.expires_at > ?)`,
  ).get(sha256(token), nowIso()) as (UserRecord & {
    credential_id: string; name: string; scopes: string; oauth_scopes?: string; expires_at: string | null;
  }) | undefined;
  if (!row) return null;
  if (oauth) {
    const valid = db.prepare("SELECT 1 FROM oauth_access_tokens WHERE token_hash = ? AND expires_at > ?").get(sha256(token), nowIso());
    if (!valid) return null;
  }
  db.prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?").run(nowIso(), row.credential_id);
  return {
    user: mapUser(row),
    credential: {
      id: row.credential_id,
      userId: row.id,
      name: row.name,
      scopes: JSON.parse(row.oauth_scopes || row.scopes) as string[],
      expiresAt: row.expires_at,
    },
  };
}

export function apiCredentialFromRequest(request: FastifyRequest): ApiCredential | null {
  const token = bearerFromRequest(request);
  return token ? authenticateApiToken(token)?.credential ?? null : null;
}

export function requireScope(request: FastifyRequest, reply: FastifyReply, scope: string): boolean {
  const credential = request.apiCredential;
  if (!credential) {
    reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "需要有效的 Bearer 访问令牌" } });
    return false;
  }
  if (!credential.scopes.includes(scope)) {
    reply.code(403).send({ error: { code: "INSUFFICIENT_SCOPE", message: `缺少权限：${scope}` } });
    return false;
  }
  return true;
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  if (!request.user) {
    reply.code(401).send({ error: "请先登录" });
    return null;
  }
  return request.user;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.appOrigin.startsWith("https://"),
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function firstUserIsAdmin(): boolean {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return row.count === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
