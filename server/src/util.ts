import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(message = "资源不存在"): never {
  throw new HttpError(404, message);
}

export function badRequest(message: string, details?: unknown): never {
  throw new HttpError(400, message, details);
}

export function parseBody<T>(schema: ZodType<T>, request: FastifyRequest): T {
  try {
    return schema.parse(request.body ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new HttpError(400, "请求参数有误", details);
    }
    throw error;
  }
}

export function parseQuery<T>(schema: ZodType<T>, request: FastifyRequest): T {
  try {
    return schema.parse(request.query ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new HttpError(400, "查询参数有误", details);
    }
    throw error;
  }
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof HttpError) {
    reply.code(error.status).send({ error: error.message, details: error.details });
    return;
  }
  const message = error instanceof Error ? error.message : "服务器内部错误";
  reply.code(500).send({ error: message });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept "2026-10-23 19:28:41" and ISO-like timestamps.
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function searchDate(value: string | undefined, end = false): string | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`
    : value;
  const iso = toIso(normalized);
  if (!iso) badRequest("无效的检索日期");
  return iso;
}

export function publicUrl(request: FastifyRequest, pathname: string): string {
  const proto = (request.headers["x-forwarded-proto"] as string) || request.protocol || "http";
  const host = (request.headers["x-forwarded-host"] as string) || request.headers.host || "localhost";
  return `${proto}://${host}${pathname}`;
}

export function csv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
