import { config as appConfig } from "../config.js";
import { removeCachedAttachment } from "../connectors/smb-cache.js";
import type { ScanSummary, ScanItem, SyncContext } from "../connectors/types.js";
import { getConnector } from "../connectors/index.js";
import { db, newId, nowIso } from "../db.js";
import { getSourceRow, sourceConfig } from "./sources.js";
import { indexDocument } from "./search.js";
import type { SourceRow, SyncJobRow } from "../types.js";

export interface SyncStats {
  scanned: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: number;
  durationMs: number;
  complete: boolean;
  note?: string;
}

interface ExistingDoc {
  id: string;
  deleted_at: string | null;
  file_path: string | null;
  source_updated_at: string | null;
  size: number | null;
  content: string | null;
}

const activeJobs = new Map<string, { jobId: string; controller: AbortController }>();
let schedulerTimer: NodeJS.Timeout | null = null;

export function isSourceSyncing(sourceId: string): boolean {
  return activeJobs.has(sourceId);
}

export function cleanupInterruptedJobs(): void {
  db.prepare(
    `UPDATE sync_jobs SET status = 'error', error = '服务重启，任务中断', finished_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(nowIso());
  db.prepare(
    `UPDATE sources SET last_sync_status = 'error', last_sync_error = '服务重启，任务中断'
     WHERE last_sync_status = 'running'`,
  ).run();
}

export function getJob(userId: string, jobId: string): SyncJobRow {
  const row = db
    .prepare("SELECT * FROM sync_jobs WHERE id = ? AND user_id = ?")
    .get(jobId, userId) as SyncJobRow | undefined;
  if (!row) throw new Error("同步任务不存在");
  return row;
}

export function startSync(
  userId: string,
  sourceId: string,
  options: { force?: boolean } = {},
): SyncJobRow {
  const source = getSourceRow(userId, sourceId);
  const connector = getConnector(source.type);
  if (!connector) throw new Error(`不支持的信息来源类型：${source.type}`);
  if (!source.enabled) throw new Error("该信息来源已停用");
  if (activeJobs.has(sourceId)) throw new Error("该信息来源正在同步中，请稍候");
  const id = newId("job");
  const now = nowIso();
  db.prepare(
    `INSERT INTO sync_jobs(id, source_id, user_id, status, created_at)
     VALUES(?, ?, ?, 'queued', ?)`,
  ).run(id, sourceId, userId, now);
  activeJobs.set(sourceId, { jobId: id, controller: new AbortController() });
  queueMicrotask(() => {
    void runJob(userId, sourceId, id, options).catch((error) => {
      // runJob writes the failure state itself; this is a last-resort guard.
      console.error("sync job failed", error);
    });
  });
  return getJob(userId, id);
}

function writeJob(id: string, stats: SyncStats): void {
  db.prepare("UPDATE sync_jobs SET stats = ? WHERE id = ?").run(JSON.stringify(stats), id);
}

function updateSourceStatus(
  sourceId: string,
  status: string,
  error: string | null,
  syncedAt?: string,
): void {
  if (syncedAt) {
    db.prepare(
      `UPDATE sources SET last_sync_at = ?, last_sync_status = ?, last_sync_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(syncedAt, status, error, nowIso(), sourceId);
  } else {
    db.prepare(
      `UPDATE sources SET last_sync_status = ?, last_sync_error = ?, updated_at = ? WHERE id = ?`,
    ).run(status, error, nowIso(), sourceId);
  }
}

export async function runJob(
  userId: string,
  sourceId: string,
  jobId: string,
  options: { force?: boolean } = {},
): Promise<SyncStats> {
  const source = getSourceRow(userId, sourceId);
  const connector = getConnector(source.type);
  if (!connector) throw new Error(`不支持的信息来源类型：${source.type}`);
  const active = activeJobs.get(sourceId);
  if (active && active.jobId !== jobId) throw new Error("该信息来源正在同步中，请稍候");
  const controller = active?.controller ?? new AbortController();
  activeJobs.set(sourceId, { jobId, controller });
  const started = Date.now();
  const stats: SyncStats = {
    scanned: 0,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    errors: 0,
    durationMs: 0,
    complete: false,
  };
  const now = nowIso();
  db.prepare(
    "UPDATE sync_jobs SET status = 'running', started_at = ?, error = NULL WHERE id = ?",
  ).run(now, jobId);
  updateSourceStatus(sourceId, "running", null);
  const config = sourceConfig(source);
  const existing = new Map<string, ExistingDoc>();
  for (const row of db
    .prepare(
      "SELECT id, external_id, source_updated_at, size, content, deleted_at, file_path FROM documents WHERE source_id = ?",
    )
    .all(sourceId) as Array<ExistingDoc & { external_id: string }>) {
    existing.set(row.external_id, row);
  }
  const seen = new Set<string>();
  let lastPersist = 0;

  const persist = (force = false) => {
    stats.durationMs = Date.now() - started;
    if (force || Date.now() - lastPersist > 1200) {
      writeJob(jobId, stats);
      lastPersist = Date.now();
    }
  };

  const ctx: SyncContext = {
    sourceId,
    userId,
    since: source.last_sync_at,
    signal: controller.signal,
    onProgress: (progress) => {
      stats.processed = progress.processed;
      persist();
    },
    log: (message) => {
      console.log(`[sync:${source.name}] ${message}`);
    },
  };

  let summary: ScanSummary = { complete: false, scanned: 0 };
  const iterator = connector.scan(config, ctx);
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        summary = next.value;
        break;
      }
      if (controller.signal.aborted) throw new Error("同步已取消");
      const item = next.value;
      stats.scanned += 1;
      seen.add(item.externalId);
      try {
        const prior = existing.get(item.externalId);
        const unchanged =
          !options.force &&
          prior &&
          !prior.deleted_at &&
          Boolean(prior.content && prior.content.length > 0) &&
          item.sourceUpdatedAt &&
          prior.source_updated_at &&
          item.sourceUpdatedAt <= prior.source_updated_at &&
          (item.size == null || prior.size == null || item.size === prior.size);
        if (unchanged) {
          stats.skipped += 1;
        } else {
          const loaded = await item.load();
          const content = (loaded.content ?? "").slice(0, 2_000_000);
          const title = (loaded.title || item.title || "未命名文档").slice(0, 1000);
          const docId = prior?.id ?? newId("doc");
          const tags = [...new Set([...(item.tags ?? []), ...(loaded.tags ?? [])])]
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 100);
          let metadata = JSON.stringify({
            ...(item.metadata ?? {}),
            ...(loaded.metadata ?? {}),
          });
          if (metadata.length > 200_000) metadata = JSON.stringify({ truncated: true });
          const timestamp = nowIso();
          db.prepare(
            `INSERT INTO documents(
              id, user_id, source_id, external_id, kind, title, description, author, url,
              mime_type, size, content, content_format, published_at, source_created_at,
              source_updated_at, file_path, metadata, created_at, updated_at, deleted_at)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(source_id, external_id) DO UPDATE SET
               title = excluded.title, description = excluded.description, author = excluded.author,
               url = excluded.url, mime_type = excluded.mime_type, size = excluded.size,
               content = excluded.content, content_format = excluded.content_format,
               published_at = excluded.published_at, source_created_at = excluded.source_created_at,
               source_updated_at = excluded.source_updated_at, file_path = excluded.file_path,
               metadata = excluded.metadata, updated_at = excluded.updated_at, deleted_at = NULL`,
          ).run(
            docId,
            userId,
            sourceId,
            item.externalId,
            item.kind,
            title,
            loaded.description ?? item.description ?? null,
            loaded.author ?? item.author ?? null,
            loaded.url ?? item.url ?? null,
            loaded.mimeType ?? item.mimeType ?? null,
            loaded.size ?? item.size ?? null,
            content,
            loaded.contentFormat ?? (item.kind === "file" ? "text" : "markdown"),
            loaded.publishedAt ?? item.publishedAt ?? null,
            loaded.sourceCreatedAt ?? item.sourceCreatedAt ?? null,
            loaded.sourceUpdatedAt ?? item.sourceUpdatedAt ?? null,
            item.filePath ?? null,
            metadata,
            timestamp,
            timestamp,
          );
          const tagInsert = db.prepare(
            "INSERT OR IGNORE INTO document_tags(document_id, tag) VALUES(?, ?)",
          );
          db.prepare("DELETE FROM document_tags WHERE document_id = ?").run(docId);
          for (const tag of tags) tagInsert.run(docId, tag);
          indexDocument(docId);
          if (prior) stats.updated += 1;
          else stats.created += 1;
        }
      } catch (error) {
        stats.errors += 1;
        ctx.log(
          `处理 ${item.title} 失败：${error instanceof Error ? error.message : String(error)}`,
        );
        // Store a metadata-only record so the file remains discoverable by name.
        if (!existing.has(item.externalId)) {
          try {
            const timestamp = nowIso();
            const docId = newId("doc");
            db.prepare(
              `INSERT OR IGNORE INTO documents(
                id, user_id, source_id, external_id, kind, title, description, mime_type, size,
                content, content_format, source_created_at, source_updated_at, file_path,
                metadata, created_at, updated_at)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'text', ?, ?, ?, ?, ?, ?)`,
            ).run(
              docId,
              userId,
              sourceId,
              item.externalId,
              item.kind,
              item.title,
              item.description ?? null,
              item.mimeType ?? null,
              item.size ?? null,
              item.sourceCreatedAt ?? null,
              item.sourceUpdatedAt ?? null,
              item.filePath ?? null,
              JSON.stringify({ ...(item.metadata ?? {}), extractionError: true }),
              timestamp,
              timestamp,
            );
            indexDocument(docId);
            stats.created += 1;
          } catch {
            // ignore secondary failures
          }
        }
      }
      persist();
    }

    stats.complete = Boolean(summary.complete);
    stats.note = summary.note;
    stats.durationMs = Date.now() - started;

    if (summary.complete) {
      const removeIndex = db.prepare("DELETE FROM documents_fts WHERE doc_id = ?");
      const softDelete = db.prepare(
        "UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?",
      );
      const timestamp = nowIso();
      const cachedToRemove: Array<string | null> = [];
      const remove = db.transaction(() => {
        for (const [externalId, row] of existing) {
          if (!row.deleted_at && !seen.has(externalId)) {
            softDelete.run(timestamp, timestamp, row.id);
            removeIndex.run(row.id);
            stats.deleted += 1;
            cachedToRemove.push(row.file_path);
          }
        }
      });
      remove();
      for (const filePath of cachedToRemove) await removeCachedAttachment(appConfig.dataDir, userId, sourceId, filePath);
    }

    persist(true);
    db.prepare(
      "UPDATE sync_jobs SET status = 'success', stats = ?, finished_at = ? WHERE id = ?",
    ).run(JSON.stringify(stats), nowIso(), jobId);
    updateSourceStatus(sourceId, "success", null, nowIso());
  } catch (error) {
    stats.durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    writeJob(jobId, stats);
    db.prepare(
      "UPDATE sync_jobs SET status = 'error', stats = ?, error = ?, finished_at = ? WHERE id = ?",
    ).run(JSON.stringify(stats), message, nowIso(), jobId);
    updateSourceStatus(sourceId, "error", message);
    throw error;
  } finally {
    try { await iterator.return({ complete: false, scanned: stats.scanned }); } catch { /* Preserve the original sync error. */ }
    activeJobs.delete(sourceId);
  }
  return stats;
}

export function cancelSourceSync(sourceId: string): boolean {
  const job = activeJobs.get(sourceId);
  if (!job) return false;
  job.controller.abort();
  return true;
}

export function startScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    try {
      const now = Date.now();
      const rows = db
        .prepare(
          `SELECT * FROM sources
           WHERE enabled = 1 AND sync_interval_minutes > 0 AND (last_sync_status IS NULL OR last_sync_status != 'running')`,
        )
        .all() as SourceRow[];
      for (const source of rows) {
        if (activeJobs.has(source.id)) continue;
        const last = source.last_sync_at ? new Date(source.last_sync_at).getTime() : 0;
        if (last && now - last < source.sync_interval_minutes * 60_000) continue;
        if (!last && source.last_sync_status === "error") {
          // Do not hammer a failing source on every tick.
          const updated = new Date(source.updated_at).getTime();
          if (now - updated < 30 * 60_000) continue;
        }
        try {
          startSync(source.user_id, source.id);
          console.log(`[scheduler] started sync for source ${source.name}`);
        } catch (error) {
          console.warn(
            `[scheduler] could not start ${source.name}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    } catch (error) {
      console.error("[scheduler] tick failed", error);
    }
  }, 120_000);
  schedulerTimer.unref?.();
}

export function stopScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  for (const [, job] of activeJobs) job.controller.abort();
  activeJobs.clear();
}
