import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, newId, nowIso } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";
import { config } from "./config.js";
import type { AuthUser, UserRole } from "./types.js";

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
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowIso()) as UserRecord | undefined;
  return row ? mapUser(row) : null;
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
