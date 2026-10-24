import type { SourceRow, SourceType } from "../types.js";
import fs from "node:fs";
import { config as appConfig } from "../config.js";
import { attachmentCacheDirectory } from "../connectors/smb-cache.js";
import { db, newId, nowIso } from "../db.js";
import { decryptJson, encryptJson } from "../crypto.js";
import { getConnector, loadConnectors } from "../connectors/index.js";
import { badRequest, HttpError, notFound } from "../util.js";

const SECRET_KEY_RE = /(password|token|secret|apikey|api_key|apilink)/i;

export interface PublicSource {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown>;
  secretFields: string[];
  docCount: number;
  activeJob: {
    id: string;
    status: string;
    stats: unknown;
    startedAt: string | null;
  } | null;
}

await loadConnectors();

export function readSecret(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

export function sanitizeConfig(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  secretFields: string[];
} {
  const clean: Record<string, unknown> = {};
  const secretFields: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEY_RE.test(key)) {
      secretFields.push(key);
      const raw = typeof value === "string" ? value : "";
      clean[key] = raw ? "••••••••" : "";
    } else if (value !== undefined) {
      clean[key] = value;
    }
  }
  return { config: clean, secretFields };
}

export function mergeConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (SECRET_KEY_RE.test(key) && (value === "" || value === null)) {
      // Keep the previously stored secret when the edit form leaves it blank.
      if (existing[key] !== undefined) continue;
    }
    merged[key] = value;
  }
  return merged;
}

export function getSourceRow(userId: string, id: string): SourceRow {
  const row = db
    .prepare("SELECT * FROM sources WHERE id = ? AND user_id = ?")
    .get(id, userId) as SourceRow | undefined;
  if (!row) notFound("信息来源不存在");
  return row;
}

export function sourceConfig(row: SourceRow): Record<string, unknown> {
  try {
    return decryptJson<Record<string, unknown>>(row.config_enc);
  } catch {
    return {};
  }
}

export function publicSource(row: SourceRow): PublicSource {
  const { config, secretFields } = sanitizeConfig(sourceConfig(row));
  const docCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM documents WHERE source_id = ? AND deleted_at IS NULL",
      )
      .get(row.id) as { count: number }
  ).count;
  const job = db
    .prepare(
      `SELECT id, status, stats, started_at FROM sync_jobs
       WHERE source_id = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(row.id) as
    | { id: string; status: string; stats: string | null; started_at: string | null }
    | undefined;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: Boolean(row.enabled),
    syncIntervalMinutes: row.sync_interval_minutes,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config,
    secretFields,
    docCount,
    activeJob: job
      ? {
          id: job.id,
          status: job.status,
          stats: job.stats ? safeJson(job.stats) : null,
          startedAt: job.started_at,
        }
      : null,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface CreateSourceInput {
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  enabled?: boolean;
  syncIntervalMinutes?: number;
}

function requireLocalAdmin(userId: string, type: SourceType): void {
  if (type !== "local") return;
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  if (user?.role !== "admin") {
    throw new HttpError(403, "只有管理员可以读取服务器本地目录，请使用自己的 SMB 账号接入文件服务");
  }
}

export function createSource(userId: string, input: CreateSourceInput): SourceRow {
  requireLocalAdmin(userId, input.type);
  const connector = getConnector(input.type);
  if (!connector) badRequest(`不支持的信息来源类型：${input.type}`);
  const id = newId("src");
  const now = nowIso();
  db.prepare(
    `INSERT INTO sources(id, user_id, name, type, config_enc, enabled, sync_interval_minutes,
      created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    input.name.trim(),
    input.type,
    encryptJson(input.config),
    input.enabled === false ? 0 : 1,
    Math.max(0, input.syncIntervalMinutes ?? 360),
    now,
    now,
  );
  return getSourceRow(userId, id);
}

export function updateSource(
  userId: string,
  id: string,
  patch: {
    name?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    syncIntervalMinutes?: number;
  },
): SourceRow {
  const row = getSourceRow(userId, id);
  requireLocalAdmin(userId, row.type);
  const config = patch.config ? mergeConfig(sourceConfig(row), patch.config) : sourceConfig(row);
  db.prepare(
    `UPDATE sources SET name = ?, config_enc = ?, enabled = ?, sync_interval_minutes = ?,
       updated_at = ? WHERE id = ?`,
  ).run(
    patch.name?.trim() || row.name,
    encryptJson(config),
    patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
    patch.syncIntervalMinutes === undefined
      ? row.sync_interval_minutes
      : Math.max(0, patch.syncIntervalMinutes),
    nowIso(),
    id,
  );
  return getSourceRow(userId, id);
}

export function deleteSource(userId: string, id: string): void {
  getSourceRow(userId, id);
  const sourceCache = attachmentCacheDirectory(appConfig.dataDir, userId, id);
  const docs = db.prepare("SELECT id FROM documents WHERE source_id = ?").all(id) as Array<{
    id: string;
  }>;
  const removeIndex = db.prepare("DELETE FROM documents_fts WHERE doc_id = ?");
  const run = db.transaction(() => {
    for (const doc of docs) removeIndex.run(doc.id);
    db.prepare("DELETE FROM sources WHERE id = ? AND user_id = ?").run(id, userId);
  });
  run();
  fs.rmSync(sourceCache, { recursive: true, force: true });
}

export interface TestSourceResult {
  ok: boolean;
  message: string;
  meta?: Record<string, unknown>;
}

export async function testSourceConfig(
  userId: string,
  type: SourceType,
  config: Record<string, unknown>,
  sourceId?: string,
): Promise<TestSourceResult> {
  requireLocalAdmin(userId, type);
  const connector = getConnector(type);
  if (!connector) badRequest(`不支持的信息来源类型：${type}`);
  let effective = config;
  if (sourceId) {
    const existing = getSourceRow(userId, sourceId);
    if (existing.type !== type) badRequest("信息来源类型不匹配");
    effective = mergeConfig(sourceConfig(existing), config);
  }
  try {
    return await connector.test(effective);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "连接测试失败",
    };
  }
}
