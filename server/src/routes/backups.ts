import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { createBackup, listBackups, verifyBackup } from "../services/backups.js";
import { sendError } from "../util.js";

export default async function backupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const user = requireUser(request, reply);
    if (user && user.role !== "admin") return reply.code(403).send({ error: "仅管理员可管理系统备份" });
  });
  app.get("/api/backups", async (_request, reply) => { try { return await listBackups(); } catch (error) { sendError(reply, error); } });
  app.post("/api/backups", async (_request, reply) => { try { return await createBackup(); } catch (error) { sendError(reply, error); } });
  app.post("/api/backups/:id/verify", async (request, reply) => { try { return await verifyBackup((request.params as { id: string }).id); } catch (error) { sendError(reply, error); } });
}
