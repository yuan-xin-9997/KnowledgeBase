import { db } from "../db.js";
import type { DocumentRow } from "../types.js";
import { HttpError } from "../util.js";
import { searchDocuments } from "./search.js";
import { createSource, getSourceRow, publicSource, updateSource, type CreateSourceInput } from "./sources.js";
import { getJob, isSourceSyncing, startSync } from "./sync.js";

export function listDocuments(userId: string, input: {
  q?: string; sourceId?: string; kind?: string; tag?: string;
  sort?: "relevance" | "newest" | "oldest"; page?: number; pageSize?: number;
}) {
  return searchDocuments({ userId, query: input.q, sourceId: input.sourceId, kind: input.kind,
    tag: input.tag, sort: input.sort, page: input.page, pageSize: input.pageSize });
}

export function getDocument(userId: string, id: string) {
  const row = db.prepare(
    `SELECT d.*, s.name AS source_name, s.type AS source_type
     FROM documents d JOIN sources s ON s.id = d.source_id
     WHERE d.id = ? AND d.user_id = ? AND d.deleted_at IS NULL`,
  ).get(id, userId) as (DocumentRow & { source_name: string; source_type: string }) | undefined;
  if (!row) throw new HttpError(404, "文档不存在");
  const tags = (db.prepare("SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag").all(id) as Array<{ tag: string }>).map((x) => x.tag);
  return {
    id: row.id, sourceId: row.source_id, sourceName: row.source_name, sourceType: row.source_type,
    externalId: row.external_id, kind: row.kind, title: row.title, description: row.description,
    author: row.author, url: row.url, mimeType: row.mime_type, size: row.size, content: row.content,
    contentFormat: row.content_format, language: row.language, publishedAt: row.published_at,
    sourceCreatedAt: row.source_created_at, sourceUpdatedAt: row.source_updated_at,
    metadata: safeJson(row.metadata), tags, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listSources(userId: string) {
  return (db.prepare("SELECT * FROM sources WHERE user_id = ? ORDER BY created_at").all(userId) as never[]).map(publicSource);
}

export function createExternalSource(userId: string, input: CreateSourceInput) {
  return publicSource(createSource(userId, input));
}

export function updateExternalSource(userId: string, id: string, input: Parameters<typeof updateSource>[2]) {
  return publicSource(updateSource(userId, id, input));
}

export function startExternalSync(userId: string, sourceId: string, force = false) {
  getSourceRow(userId, sourceId);
  if (isSourceSyncing(sourceId)) throw new HttpError(409, "该信息来源正在同步中");
  return publicJob(getJob(userId, startSync(userId, sourceId, { force }).id));
}

export function getExternalJob(userId: string, jobId: string) { return publicJob(getJob(userId, jobId)); }

function publicJob(job: ReturnType<typeof getJob>) {
  return { id: job.id, sourceId: job.source_id, status: job.status,
    stats: safeJson(job.stats), error: job.error, startedAt: job.started_at,
    finishedAt: job.finished_at, createdAt: job.created_at };
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
