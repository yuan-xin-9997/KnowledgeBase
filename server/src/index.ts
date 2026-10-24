import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { config } from "./config.js";
import { db } from "./db.js";
import { userFromRequest } from "./auth.js";
import { HttpError } from "./util.js";
import authRoutes from "./routes/auth.js";
import sourceRoutes from "./routes/sources.js";
import documentRoutes from "./routes/documents.js";
import searchRoutes from "./routes/search.js";
import tagRoutes from "./routes/tags.js";
import statsRoutes from "./routes/stats.js";
import providerRoutes from "./routes/providers.js";
import chatRoutes from "./routes/chat.js";
import { cleanupInterruptedJobs, startScheduler, stopScheduler } from "./services/sync.js";

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
          },
  },
  trustProxy: "loopback",
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(cookie);

app.decorateRequest("user", null);
app.addHook("onRequest", async (request) => {
  request.user = userFromRequest(request);
});

// Basic CSRF hardening for cookie-authenticated mutations.
app.addHook("onRequest", async (request, reply) => {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originHost = new URL(origin).host;
    const host = request.headers.host;
    const allowed = config.appOrigin ? new URL(config.appOrigin).host : host;
    const devOrigins = ["localhost:5173", "127.0.0.1:5173"];
    const devAllowed = process.env.NODE_ENV !== "production" && devOrigins.includes(originHost);
    if (originHost !== host && originHost !== allowed && !devAllowed) {
      reply.code(403).send({ error: "跨站请求被拒绝" });
    }
  } catch {
    reply.code(400).send({ error: "无效的 Origin" });
  }
});

app.get("/api/health", async () => {
  db.prepare("SELECT 1").get();
  return {
    ok: true,
    service: "knowledge-base",
    version: "1.0.0",
    time: new Date().toISOString(),
  };
});

await app.register(authRoutes);
await app.register(sourceRoutes);
await app.register(documentRoutes);
await app.register(searchRoutes);
await app.register(tagRoutes);
await app.register(statsRoutes);
await app.register(providerRoutes);
await app.register(chatRoutes);

if (config.webDist) {
  const root = path.resolve(config.webDist);
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    wildcard: true,
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ error: "接口不存在" });
      return;
    }
    reply.sendFile("index.html");
  });
} else {
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: request.url.startsWith("/api/")
        ? "接口不存在"
        : "前端尚未构建，请运行 npm run build:web",
    });
  });
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof HttpError) {
    reply.code(error.status).send({ error: error.message, details: error.details });
    return;
  }
  const err = error as { statusCode?: number; message?: string };
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500) {
    request.log.error(error);
  }
  reply.code(statusCode).send({
    error: statusCode >= 500 ? "服务器内部错误" : err.message || "请求失败",
  });
});

cleanupInterruptedJobs();
if (config.syncScheduler) startScheduler();

app.addHook("onClose", async () => {
  stopScheduler();
});

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`);
  try {
    stopScheduler();
    await app.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `Knowledge Base ready at http://${config.host}:${config.port} (data: ${config.dataDir})`,
  );
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

export { app };
