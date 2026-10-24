import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, newId, nowIso } from "../db.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  firstUserIsAdmin,
  hashPassword,
  mapUser,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { config } from "../config.js";
import { parseBody, sendError } from "../util.js";
import type { AuthUser, UserRole } from "../types.js";

const newPasswordSchema = z.string().min(8, "密码至少 8 位").max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "密码 UTF-8 编码不能超过 72 字节");

const registerSchema = z.object({
  email: z.string().trim().email("请输入有效邮箱"),
  username: z
    .string()
    .trim()
    .min(3, "用户名至少 3 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能包含字母、数字、下划线、点和短横线"),
  password: newPasswordSchema,
  displayName: z.string().trim().max(64).optional(),
});

const loginSchema = z.object({
  account: z.string().trim().min(1, "请输入邮箱或用户名"),
  password: z.string().min(1, "请输入密码").max(128),
});

interface Attempt {
  count: number;
  resetAt: number;
}
const loginAttempts = new Map<string, Attempt>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  if (loginAttempts.size >= 10_000) {
    for (const [entry, attempt] of loginAttempts) if (attempt.resetAt < now) loginAttempts.delete(entry);
    if (loginAttempts.size >= 10_000 && !loginAttempts.has(key)) return false;
  }
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  attempt.count += 1;
  return attempt.count <= 10;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    try {
      if (!config.allowRegistration) {
        reply.code(403).send({ error: "当前未开放注册" });
        return;
      }
      if (!checkRateLimit(`register:${request.ip}`)) {
        reply.code(429).send({ error: "注册次数过多，请 15 分钟后再试" });
        return;
      }
      const body = parseBody(registerSchema, request);
      const exists = db
        .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
        .get(body.email, body.username);
      if (exists) {
        reply.code(409).send({ error: "该邮箱或用户名已被使用" });
        return;
      }
      const passwordHash = await hashPassword(body.password);
      // Decide the first administrator after hashing, without an async registration race.
      const role: UserRole = firstUserIsAdmin() ? "admin" : "user";
      const id = newId("usr");
      db.prepare(
        `INSERT INTO users(id, email, username, password_hash, display_name, role, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        body.email.toLowerCase(),
        body.username,
        passwordHash,
        body.displayName || body.username,
        role,
        nowIso(),
      );
      const session = createSession(id);
      setSessionCookie(reply, session.token, session.expiresAt);
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      reply.code(201).send({ user: mapUser(row as never) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    try {
      const body = parseBody(loginSchema, request);
      const key = `${request.ip}:${body.account.toLowerCase()}`;
      if (!checkRateLimit(key) || !checkRateLimit(`login-ip:${request.ip}`)) {
        reply.code(429).send({ error: "尝试次数过多，请 15 分钟后再试" });
        return;
      }
      const row = db
        .prepare("SELECT * FROM users WHERE email = ? OR username = ?")
        .get(body.account.toLowerCase(), body.account) as
        | {
            id: string;
            password_hash: string;
          }
        | undefined;
      if (!row || !(await verifyPassword(body.password, row.password_hash))) {
        reply.code(401).send({ error: "账号或密码不正确" });
        return;
      }
      const session = createSession(row.id);
      loginAttempts.delete(key);
      setSessionCookie(reply, session.token, session.expiresAt);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
      reply.send({ user: mapUser(user as never) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) destroySession(token);
    clearSessionCookie(reply);
    reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: "未登录" });
      return;
    }
    reply.send({ user: request.user });
  });

  app.patch("/api/auth/me", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const body = parseBody(
        z.object({
          displayName: z.string().trim().min(1).max(64).optional(),
          password: newPasswordSchema.optional(),
        }),
        request,
      );
      if (body.displayName) {
        db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(body.displayName, user.id);
      }
      if (body.password) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
          await hashPassword(body.password),
          user.id,
        );
      }
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      reply.send({ user: mapUser(row as never) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/auth/users", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (user.role !== "admin") {
      reply.code(403).send({ error: "需要管理员权限" });
      return;
    }
    const rows = db
      .prepare("SELECT id, email, username, display_name, role, created_at FROM users ORDER BY created_at")
      .all() as Array<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      role: string;
      created_at: string;
    }>;
    reply.send({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        createdAt: row.created_at,
      })),
    });
  });
}

export type { AuthUser };
