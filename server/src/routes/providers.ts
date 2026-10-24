import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { parseBody, sendError } from "../util.js";
import {
  createProvider,
  deleteProvider,
  getProviderRow,
  listProviders,
  publicProvider,
  testProviderConnection,
  updateProvider,
} from "../services/ai.js";

const baseUrlSchema = z
  .string()
  .trim()
  .min(1, "请输入 Base URL")
  .max(500, "Base URL 过长")
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Base URL 必须是 http:// 或 https:// 开头的有效地址");

const apiKeySchema = z.string().trim().min(1, "请输入 API Key").max(2000);

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入配置名称").max(100, "配置名称过长"),
  protocol: z.enum(["openai", "anthropic"], { message: "协议必须是 openai 或 anthropic" }),
  baseUrl: baseUrlSchema,
  apiKey: apiKeySchema,
  model: z.string().trim().min(1, "请输入模型名称").max(200, "模型名称过长"),
  temperature: z.number().min(0, "温度不能小于 0").max(2, "温度不能大于 2").optional(),
  maxTokens: z.number().int().min(1, "最大 Token 数至少为 1").max(32768, "最大 Token 数不能超过 32768").optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1, "配置名称不能为空").max(100, "配置名称过长").optional(),
  protocol: z.enum(["openai", "anthropic"], { message: "协议必须是 openai 或 anthropic" }).optional(),
  baseUrl: baseUrlSchema.optional(),
  // An empty string means "keep the stored key".
  apiKey: z.string().trim().max(2000).optional(),
  model: z.string().trim().min(1, "模型名称不能为空").max(200, "模型名称过长").optional(),
  temperature: z.number().min(0, "温度不能小于 0").max(2, "温度不能大于 2").optional(),
  maxTokens: z.number().int().min(1, "最大 Token 数至少为 1").max(32768, "最大 Token 数不能超过 32768").optional(),
});

export default async function providerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/providers", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      reply.send({ providers: listProviders(user.id).map(publicProvider) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/providers", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const body = parseBody(createSchema, request);
      const row = createProvider(user.id, body);
      reply.code(201).send({ provider: publicProvider(row) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch("/api/providers/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const body = parseBody(patchSchema, request);
      const row = updateProvider(user.id, id, body);
      reply.send({ provider: publicProvider(row) });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/providers/:id", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      deleteProvider(user.id, id);
      reply.send({ ok: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/providers/:id/test", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    try {
      const { id } = request.params as { id: string };
      const row = getProviderRow(user.id, id);
      reply.send(await testProviderConnection(row));
    } catch (error) {
      // A failed connection test is not a server error.
      reply.send({
        ok: false,
        message: error instanceof Error ? error.message : "连接测试失败",
      });
    }
  });
}
