import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AiProviderRow, ChatMessageRow, ChatSessionRow } from "../types.js";
import { db, newId, nowIso } from "../db.js";
import { requireUser } from "../auth.js";
import { HttpError, notFound, parseBody, sendError } from "../util.js";
import {
  AiError,
  getLatestProvider,
  getProviderRow,
  streamChat,
  trimHistory,
  type ChatTurn,
  type Citation,
} from "../services/ai.js";
import {
  fallbackContext,
  normalizeScope,
  parseScope,
  retrieveContext,
  serializeScope,
  type RetrievedContext,
} from "../services/rag.js";

const scopeSchema = z.object({
  mode: z.enum(["all", "sources", "documents", "none"]).optional(),
  sourceIds: z.array(z.string().trim().min(1)).max(100).optional(),
  documentIds: z.array(z.string().trim().min(1)).max(100).optional(),
});

const sessionCreateSchema = z.object({
  title: z.string().trim().max(100, "会话标题过长").optional(),
  providerId: z.string().trim().min(1).nullable().optional(),
  scope: scopeSchema.optional(),
});

const sessionPatchSchema = sessionCreateSchema.partial();

const messageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "消息内容不能为空")
    .max(20_000, "消息内容过长（最多 20000 字）"),
});

interface SessionStats {
  messageCount: number;
  lastMessage: string | null;
}

function getSessionRow(userId: string, id: string): ChatSessionRow {
  const row = db
    .prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?")
    .get(id, userId) as ChatSessionRow | undefined;
  if (!row) notFound("会话不存在");
  return row;
}

function parseCitations(value: string | null): Citation[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Citation[]) : null;
  } catch {
    return null;
  }
}

function publicMessage(row: ChatMessageRow): {
  id: string;
  role: ChatMessageRow["role"];
  content: string;
  citations: Citation[] | null;
  createdAt: string;
} {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: parseCitations(row.citations),
    createdAt: row.created_at,
  };
}

function sessionStats(sessionId: string): SessionStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              (SELECT content FROM chat_messages WHERE session_id = ?
               ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last
       FROM chat_messages WHERE session_id = ?`,
    )
    .get(sessionId, sessionId) as { count: number; last: string | null };
  return {
    messageCount: row.count,
    lastMessage: row.last ? row.last.replace(/\s+/g, " ").trim().slice(0, 200) : null,
  };
}

function publicSession(row: ChatSessionRow, stats?: SessionStats) {
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id,
    scope: parseScope(row.scope),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(stats ?? {}),
  };
}

function resolveSessionProvider(userId: string, session: ChatSessionRow): AiProviderRow | null {
  if (session.provider_id) {
    const row = db
      .prepare("SELECT * FROM ai_providers WHERE id = ? AND user_id = ?")
      .get(session.provider_id, userId) as AiProviderRow | undefined;
    if (row) return row;
  }
  return getLatestProvider(userId);
}

function titleFromMessage(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "新会话";
  return clean.length > 30 ? clean.slice(0, 30) : clean;
}

export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/chat/sessions", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const rows = db
        .prepare(
          `SELECT s.*,
                  (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
                  (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id
                   ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message
           FROM chat_sessions s
           WHERE s.user_id = ?
           ORDER BY s.updated_at DESC, s.rowid DESC`,
        )
        .all(user.id) as Array<
        ChatSessionRow & { message_count: number; last_message: string | null }
      >;
      reply.send({
        sessions: rows.map((row) =>
          publicSession(row, {
            messageCount: row.message_count,
            lastMessage: row.last_message
              ? row.last_message.replace(/\s+/g, " ").trim().slice(0, 200)
              : null,
          }),
        ),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/chat/sessions", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const body = parseBody(sessionCreateSchema, request);
      const providerId = body.providerId ? getProviderRow(user.id, body.providerId).id : null;
      const scope = normalizeScope(body.scope);
      const title = body.title?.trim() || "新会话";
      const id = newId("cht");
      const now = nowIso();
      db.prepare(
        `INSERT INTO chat_sessions(id, user_id, title, provider_id, scope, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, user.id, title, providerId, serializeScope(scope), now, now);
      const row = getSessionRow(user.id, id);
      reply.code(201).send({ session: publicSession(row, sessionStats(id)) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/chat/sessions/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const row = getSessionRow(user.id, id);
      const messages = db
        .prepare(
          "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
        )
        .all(id) as ChatMessageRow[];
      reply.send({
        session: publicSession(row, sessionStats(id)),
        messages: messages.map(publicMessage),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch("/api/chat/sessions/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const row = getSessionRow(user.id, id);
      const body = parseBody(sessionPatchSchema, request);
      let providerId = row.provider_id;
      if (body.providerId !== undefined) {
        providerId = body.providerId ? getProviderRow(user.id, body.providerId).id : null;
      }
      const scope =
        body.scope === undefined
          ? parseScope(row.scope)
          : normalizeScope(body.scope, parseScope(row.scope));
      const title =
        body.title === undefined ? row.title : body.title.trim() || "新会话";
      db.prepare(
        "UPDATE chat_sessions SET title = ?, provider_id = ?, scope = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      ).run(title, providerId, serializeScope(scope), nowIso(), id, user.id);
      const updated = getSessionRow(user.id, id);
      reply.send({ session: publicSession(updated, sessionStats(id)) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/chat/sessions/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      getSessionRow(user.id, id);
      db.prepare("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?").run(id, user.id);
      reply.send({ ok: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/chat/sessions/:id/messages", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;

    let session: ChatSessionRow;
    let content: string;
    try {
      const { id } = request.params as { id: string };
      session = getSessionRow(user.id, id);
      content = parseBody(messageSchema, request).content;
    } catch (error) {
      sendError(reply, error);
      return;
    }

    const provider = resolveSessionProvider(user.id, session);
    if (!provider) {
      reply
        .code(400)
        .send({ error: "尚未配置可用的 AI 模型，请先在设置中添加模型配置" });
      return;
    }

    const scope = parseScope(session.scope);

    let context: RetrievedContext;
    try {
      context = retrieveContext(user.id, content, scope);
    } catch (error) {
      request.log.warn({ err: error }, "chat retrieval failed, falling back to general knowledge");
      context = fallbackContext(error instanceof Error ? error.message : "知识库检索失败");
    }

    let history: Array<{ role: ChatMessageRow["role"]; content: string }>;
    try {
      history = db
        .prepare(
          `SELECT role, content FROM chat_messages WHERE session_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT 10`,
        )
        .all(session.id) as Array<{ role: ChatMessageRow["role"]; content: string }>;
    } catch (error) {
      sendError(reply, error);
      return;
    }
    history.reverse();
    const turns: ChatTurn[] = history.map((item) => ({
      role: item.role,
      content: item.content,
    }));
    turns.push({ role: "user", content });
    const messages = trimHistory(turns, 10, 20_000);

    const now = nowIso();
    const userMessageId = newId("msg");
    const assistantMessageId = newId("msg");
    let title = session.title;

    try {
      const priorUserCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND role = 'user'",
          )
          .get(session.id) as { count: number }
      ).count;
      if (priorUserCount === 0 && (!title.trim() || title === "新会话")) {
        title = titleFromMessage(content);
      }
      const run = db.transaction(() => {
        db.prepare(
          `INSERT INTO chat_messages(id, session_id, role, content, citations, created_at)
           VALUES(?, ?, 'user', ?, NULL, ?)`,
        ).run(userMessageId, session.id, content, now);
        db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
          title,
          now,
          session.id,
          user.id,
        );
      });
      run();
    } catch (error) {
      sendError(reply, error);
      return;
    }

    // From here on the response is a raw SSE stream; manage it manually.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let closed = false;
    const controller = new AbortController();
    const onClose = (): void => {
      if (res.writableFinished) return;
      closed = true;
      controller.abort();
    };
    res.on("close", onClose);

    const send = (event: unknown): boolean => {
      if (closed || res.writableEnded || res.destroyed) return false;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        return true;
      } catch {
        closed = true;
        controller.abort();
        return false;
      }
    };

    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        res.write(": ping\n\n");
      } catch {
        // The close handler cleans up.
      }
    }, 15_000);

    send({
      type: "start",
      userMessage: {
        id: userMessageId,
        role: "user",
        content,
        citations: null,
        createdAt: now,
      },
      messageId: assistantMessageId,
    });
    send({ type: "citations", citations: context.citations });

    let assistantText = "";
    try {
      assistantText = await streamChat({
        provider,
        system: context.systemPrompt,
        messages,
        maxTokens: provider.max_tokens,
        temperature: provider.temperature,
        signal: controller.signal,
        onDelta: (delta) => {
          assistantText += delta;
          send({ type: "delta", text: delta });
        },
      });

      if (!assistantText.trim()) {
        send({ type: "error", error: "模型没有返回内容，请检查模型配置或稍后重试" });
      } else {
        const doneAt = nowIso();
        const citationsJson = context.citations.length
          ? JSON.stringify(context.citations)
          : null;
        try {
          const run = db.transaction(() => {
            db.prepare(
              `INSERT INTO chat_messages(id, session_id, role, content, citations, created_at)
               VALUES(?, ?, 'assistant', ?, ?, ?)`,
            ).run(assistantMessageId, session.id, assistantText, citationsJson, doneAt);
            db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ? AND user_id = ?").run(
              doneAt,
              session.id,
              user.id,
            );
          });
          run();
          send({
            type: "done",
            message: {
              id: assistantMessageId,
              role: "assistant",
              content: assistantText,
              citations: context.citations.length ? context.citations : null,
              createdAt: doneAt,
            },
          });
        } catch (error) {
          request.log.error({ err: error }, "failed to persist assistant message");
          send({ type: "error", error: "助手回复保存失败，请重试" });
        }
      }
    } catch (error) {
      const aborted = error instanceof AiError ? error.aborted : controller.signal.aborted;
      if (!aborted && !closed) {
        request.log.warn({ err: error }, "chat upstream failed");
        const message =
          error instanceof AiError || error instanceof HttpError
            ? error.message
            : "模型调用失败，请稍后重试";
        send({ type: "error", error: message });
      }
    } finally {
      clearInterval(heartbeat);
      res.off("close", onClose);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          // Socket already gone.
        }
      }
    }
  });
}
