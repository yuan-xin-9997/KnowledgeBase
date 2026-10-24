import { db } from "../db.js";
import type { SearchResult } from "../types.js";

const CJK_RE =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u31f0-\u31ff]/;

function isCjk(char: string): boolean {
  return CJK_RE.test(char);
}

/**
 * Turn arbitrary text into an FTS-friendly token stream.
 * Chinese/Japanese characters are emitted as individual tokens so that
 * phrase search works without a dictionary-based segmenter.
 */
export function toFtsText(input: string): string {
  if (!input) return "";
  const text = input.normalize("NFKC").replace(/\u0000/g, " ");
  let output = "";
  let buffer = "";
  const flush = () => {
    if (buffer) {
      output += ` ${buffer.toLowerCase()} `;
      buffer = "";
    }
  };
  for (const char of text) {
    if (isCjk(char)) {
      flush();
      output += ` ${char} `;
    } else if (/[\p{L}\p{N}_]/u.test(char)) {
      buffer += char;
    } else {
      flush();
    }
  }
  flush();
  return output.replace(/\s+/g, " ").trim().slice(0, 600_000);
}

export function extractTerms(query: string): string[] {
  const normalized = query.normalize("NFKC");
  const terms = new Set<string>();
  const matches = normalized.match(/[\p{Script=Han}\u3040-\u30ff]+|[\p{L}\p{N}_-]+/gu) ?? [];
  for (const match of matches) {
    const cleaned = match.replace(/^-+|-+$/g, "");
    if (cleaned.length >= 1) terms.add(cleaned);
  }
  return [...terms].slice(0, 12);
}

function escapeFtsToken(token: string): string {
  return token.replace(/["'*()^:{}[\]]/g, "").trim();
}

export function buildMatchQuery(query: string): string | null {
  const rawTerms = extractTerms(query);
  if (rawTerms.length === 0) return null;
  const parts: string[] = [];
  for (const raw of rawTerms) {
    const token = escapeFtsToken(raw);
    if (!token) continue;
    if (CJK_RE.test(token)) {
      const chars = [...token].filter((char) => isCjk(char));
      if (chars.length === 0) continue;
      parts.push(`"${chars.join(" ")}"`);
    } else {
      parts.push(`"${token.toLowerCase()}"*`);
    }
  }
  return parts.length ? parts.join(" AND ") : null;
}

export interface SearchOptions {
  userId: string;
  query?: string;
  mode?: "all" | "title" | "content" | "attachment";
  sourceId?: string;
  sourceIds?: string[];
  kind?: string;
  tag?: string;
  from?: string;
  to?: string;
  sort?: "relevance" | "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  terms: string[];
}

interface SearchRow {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  kind: string;
  source_id: string;
  source_name: string;
  author: string | null;
  url: string | null;
  mime_type: string | null;
  published_at: string | null;
  source_created_at: string | null;
  updated_at: string;
  rank: number;
}

function makeSnippet(row: SearchRow, terms: string[], maxLength = 240): string {
  const source = (row.content || row.description || "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const haystack = source.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = haystack.indexOf(term.toLowerCase());
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return source.slice(0, maxLength) + (source.length > maxLength ? "…" : "");
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(source.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${
    end < source.length ? "…" : ""
  }`;
}

function tagsForDocuments(ids: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT document_id, tag FROM document_tags WHERE document_id IN (${placeholders}) ORDER BY tag`,
    )
    .all(...ids) as Array<{ document_id: string; tag: string }>;
  for (const row of rows) {
    const list = map.get(row.document_id) ?? [];
    list.push(row.tag);
    map.set(row.document_id, list);
  }
  return map;
}

function buildFilters(
  options: SearchOptions,
  alias: string,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [`${alias}.user_id = ?`, `${alias}.deleted_at IS NULL`];
  const params: unknown[] = [options.userId];
  if (options.sourceId) {
    clauses.push(`${alias}.source_id = ?`);
    params.push(options.sourceId);
  }
  if (options.sourceIds?.length) {
    clauses.push(`${alias}.source_id IN (${options.sourceIds.map(() => "?").join(",")})`);
    params.push(...options.sourceIds);
  }
  if (options.mode === "attachment") clauses.push(`${alias}.kind = 'file'`);
  if (options.kind) {
    clauses.push(`${alias}.kind = ?`);
    params.push(options.kind);
  }
  if (options.tag) {
    clauses.push(
      `EXISTS (SELECT 1 FROM document_tags dt WHERE dt.document_id = ${alias}.id AND dt.tag = ?)`,
    );
    params.push(options.tag);
  }
  if (options.from) {
    clauses.push(`COALESCE(${alias}.published_at, ${alias}.source_created_at, ${alias}.created_at) >= ?`);
    params.push(options.from);
  }
  if (options.to) {
    clauses.push(`COALESCE(${alias}.published_at, ${alias}.source_created_at, ${alias}.created_at) <= ?`);
    params.push(options.to);
  }
  return { sql: clauses.join(" AND "), params };
}

export function searchDocuments(options: SearchOptions): SearchResponse {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
  const terms = options.query ? extractTerms(options.query) : [];
  const match = options.query ? buildMatchQuery(options.query) : null;
  const filters = buildFilters(options, "d");
  const offset = (page - 1) * pageSize;

  if (!match) {
    const order =
      options.sort === "oldest"
        ? "COALESCE(d.published_at, d.source_created_at, d.created_at) ASC"
        : "COALESCE(d.published_at, d.source_created_at, d.created_at) DESC";
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM documents d WHERE ${filters.sql}`).get(
        ...filters.params,
      ) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.description, d.content, d.kind, d.source_id,
                s.name AS source_name, d.author, d.url, d.mime_type,
                d.published_at, d.source_created_at, d.updated_at, 0 AS rank
         FROM documents d JOIN sources s ON s.id = d.source_id
         WHERE ${filters.sql}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...filters.params, pageSize, offset) as SearchRow[];
    const tagMap = tagsForDocuments(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toResult(row, tagMap, terms, 260)),
      total,
      page,
      pageSize,
      terms,
    };
  }

  const columnFilter = options.mode === "title" ? `{title} : (${match})`
    : options.mode === "content" ? `{body} : (${match})` : match;
  const rankExpression = "bm25(documents_fts, 0.0, 8.0, 1.0, 3.0)";
  const order =
    options.sort === "newest"
      ? "COALESCE(d.published_at, d.source_created_at, d.created_at) DESC"
      : options.sort === "oldest"
        ? "COALESCE(d.published_at, d.source_created_at, d.created_at) ASC"
        : `${rankExpression} ASC, COALESCE(d.source_created_at, d.created_at) DESC`;

  let total = 0;
  let rows: SearchRow[] = [];
  try {
    total = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM documents_fts
           JOIN documents d ON d.id = documents_fts.doc_id
           WHERE documents_fts MATCH ? AND ${filters.sql}`,
        )
        .get(columnFilter, ...filters.params) as { count: number }
    ).count;
    rows = db
      .prepare(
        `SELECT d.id, d.title, d.description, d.content, d.kind, d.source_id,
                s.name AS source_name, d.author, d.url, d.mime_type,
                d.published_at, d.source_created_at, d.updated_at,
                ${rankExpression} AS rank
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.doc_id
         JOIN sources s ON s.id = d.source_id
         WHERE documents_fts MATCH ? AND ${filters.sql}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(columnFilter, ...filters.params, pageSize, offset) as SearchRow[];
  } catch {
    // Malformed user query: fall back to a LIKE scan instead of failing the request.
    const like = `%${(options.query ?? "").replace(/[\\%_]/g, "\\$&")}%`;
    const columns = options.mode === "title" ? ["title"] : options.mode === "content" ? ["content", "description"] : ["title", "content", "description"];
    const likeFilter = `${filters.sql} AND (${columns.map((column) => `d.${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
    const likeParams = columns.map(() => like);
    total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM documents d WHERE ${likeFilter}`)
        .get(...filters.params, ...likeParams) as { count: number }
    ).count;
    rows = db
      .prepare(
        `SELECT d.id, d.title, d.description, d.content, d.kind, d.source_id,
                s.name AS source_name, d.author, d.url, d.mime_type,
                d.published_at, d.source_created_at, d.updated_at, 0 AS rank
         FROM documents d JOIN sources s ON s.id = d.source_id
         WHERE ${likeFilter}
         ORDER BY COALESCE(d.source_created_at, d.created_at) DESC LIMIT ? OFFSET ?`,
      )
      .all(...filters.params, ...likeParams, pageSize, offset) as SearchRow[];
  }

  const tagMap = tagsForDocuments(rows.map((row) => row.id));
  return {
    items: rows.map((row) => toResult(row, tagMap, terms, 280)),
    total,
    page,
    pageSize,
    terms,
  };
}

function toResult(
  row: SearchRow,
  tagMap: Map<string, string[]>,
  terms: string[],
  snippetLength: number,
): SearchResult {
  return {
    id: row.id,
    title: row.title,
    snippet: makeSnippet(row, terms, snippetLength),
    kind: row.kind,
    sourceId: row.source_id,
    sourceName: row.source_name,
    author: row.author,
    url: row.url,
    mimeType: row.mime_type,
    tags: tagMap.get(row.id) ?? [],
    publishedAt: row.published_at,
    sourceCreatedAt: row.source_created_at,
    updatedAt: row.updated_at,
    rank: row.rank,
    highlights: terms,
  };
}

export function indexDocument(documentId: string): void {
  const row = db
    .prepare(
      `SELECT d.id, d.title, d.content, d.description,
              (SELECT GROUP_CONCAT(tag, ' ') FROM document_tags WHERE document_id = d.id) AS tags
       FROM documents d WHERE d.id = ?`,
    )
    .get(documentId) as
    | { id: string; title: string; content: string | null; description: string | null; tags: string | null }
    | undefined;
  if (!row) return;
  db.prepare("DELETE FROM documents_fts WHERE doc_id = ?").run(documentId);
  db.prepare(
    "INSERT INTO documents_fts(doc_id, title, body, tags) VALUES(?, ?, ?, ?)",
  ).run(
    documentId,
    toFtsText(row.title),
    toFtsText(`${row.description ?? ""}\n${row.content ?? ""}`),
    toFtsText(row.tags ?? ""),
  );
}

export function removeFromIndex(documentId: string): void {
  db.prepare("DELETE FROM documents_fts WHERE doc_id = ?").run(documentId);
}

export function reindexUser(userId: string): number {
  const rows = db
    .prepare("SELECT id FROM documents WHERE user_id = ? AND deleted_at IS NULL")
    .all(userId) as Array<{ id: string }>;
  const run = db.transaction(() => {
    for (const row of rows) indexDocument(row.id);
  });
  run();
  return rows.length;
}

function retrievalTerms(query: string): string[] {
  return extractTerms(query).flatMap((term) => CJK_RE.test(term)
    ? Array.from({ length: Math.max(0, term.length - 1) }, (_, index) => term.slice(index, index + 2))
    : [term]).filter((term) => !["请用", "请问", "什么", "哪些", "如何", "这个", "中的", "内容", "总结", "资料"].includes(term)).slice(0, 60);
}

/** Keep passages near query terms so relevant content late in a long file remains usable. */
function relevantExcerpt(content: string, query: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const terms = retrievalTerms(query).map((term) => term.toLowerCase());
  const chunks = content.match(/[\s\S]{1,1800}/g) ?? [];
  const ranked = chunks.map((text, index) => ({
    text, index, score: terms.reduce((score, term) => score + (text.toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, Math.max(1, Math.floor(maxChars / 1800))).sort((a, b) => a.index - b.index)
    .map((chunk) => `[片段 ${chunk.index + 1}]\n${chunk.text}`).join("\n…\n").slice(0, maxChars);
}

function titleKey(title: string): string {
  return title.normalize("NFKC").replace(/[《》]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function namedTitles(query: string): string[] {
  return [...new Set([...query.matchAll(/《+([^《》]+)》+/gu)].map((match) => titleKey(match[1])).filter(Boolean))];
}

function documentExcerptQuery(query: string, title: string): string {
  if (!namedTitles(query).includes(titleKey(title))) return query;
  return `${title} ${query.replace(/《+[^《》]+》+/gu, " ")}`;
}

db.function("kb_title_key", { deterministic: true }, (title) => titleKey(String(title ?? "")));

function namedDocumentIds(userId: string, query: string, sourceIds: string[] | undefined, limit: number): string[] {
  // A stored title may already include book brackets, producing 《《title》》 in a question.
  const titles = namedTitles(query);
  if (titles.length === 0) return [];
  const filters = buildFilters({ userId, sourceIds }, "d");
  const rows = db.prepare(`SELECT d.id, kb_title_key(d.title) AS title_key FROM documents d
    WHERE ${filters.sql} AND kb_title_key(d.title) IN (${titles.map(() => "?").join(",")})
    ORDER BY d.updated_at DESC, d.id`).all(...filters.params, ...titles) as Array<{ id: string; title_key: string }>;
  // Give each distinct named title a place before adding duplicate copies from other sources.
  const first = titles.flatMap((title) => rows.find((row) => row.title_key === title)?.id ?? []);
  return [...new Set([...first, ...rows.map((row) => row.id)])].slice(0, limit);
}

/** Find relevant chunks for RAG retrieval. */
export function retrieveForAi(
  userId: string,
  query: string,
  scope: { sourceIds?: string[]; documentIds?: string[] },
  limit = 8,
): Array<{ id: string; title: string; content: string; sourceId: string; sourceName: string; url: string | null }> {
  if (scope.documentIds?.length) {
    const placeholders = scope.documentIds.map(() => "?").join(",");
    const filters = buildFilters({ userId, sourceIds: scope.sourceIds }, "d");
    const rows = db
      .prepare(
        `SELECT d.id, d.title, d.content, d.source_id, s.name AS source_name, d.url
         FROM documents d JOIN sources s ON s.id = d.source_id
         WHERE ${filters.sql} AND d.id IN (${placeholders})`,
      )
      .all(...filters.params, ...scope.documentIds) as Array<{
      id: string;
      title: string;
      content: string | null;
      source_id: string;
      source_name: string;
      url: string | null;
    }>;
    return rows.sort((a, b) => scope.documentIds!.indexOf(a.id) - scope.documentIds!.indexOf(b.id)).slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      content: relevantExcerpt(row.content ?? "", documentExcerptQuery(query, row.title), 12_000),
      sourceId: row.source_id,
      sourceName: row.source_name,
      url: row.url,
    }));
  }

  const namedIds = namedDocumentIds(userId, query, scope.sourceIds, limit);
  const response = searchDocuments({
    userId,
    query,
    mode: "all",
    sourceIds: scope.sourceIds,
    pageSize: limit,
  });
  let candidateIds = response.items.map((item) => item.id);
  if (candidateIds.length === 0) {
    const terms = retrievalTerms(query);
    const looseMatch = terms.map((term) => buildMatchQuery(term)).filter(Boolean).join(" OR ");
    if (looseMatch) {
      const filters = buildFilters({ userId, sourceIds: scope.sourceIds }, "d");
      const rows = db.prepare(`SELECT d.id FROM documents_fts JOIN documents d ON d.id = documents_fts.doc_id
        WHERE documents_fts MATCH ? AND ${filters.sql}
        ORDER BY bm25(documents_fts, 0, 8, 1, 3) LIMIT ?`).all(looseMatch, ...filters.params, limit) as Array<{ id: string }>;
      candidateIds = rows.map((row) => row.id);
    }
  }
  const ids = [...new Set([...namedIds, ...candidateIds])].slice(0, limit);
  return ids.length ? retrieveForAi(userId, query, { ...scope, documentIds: ids }, limit) : [];
}
