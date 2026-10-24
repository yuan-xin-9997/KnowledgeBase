import type { Connector, LoadedContent, ScanItem, ScanSummary, SyncContext } from "./types.js";

const DEFAULT_SERVER = "cubox.pro";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

interface CuboxFolder {
  id?: string;
  name?: string;
  nested_name?: string;
  parent_id?: string;
}

interface CuboxTag {
  id?: string;
  name?: string;
  nested_name?: string;
}

interface CuboxAnnotation {
  id?: string;
  text?: string;
  note?: string;
  color?: string;
  image_url?: string;
  cubox_url?: string;
  create_time?: string;
}

interface CuboxCard {
  id: string;
  title?: string | null;
  article_title?: string | null;
  description?: string | null;
  domain?: string | null;
  url?: string | null;
  read?: boolean;
  starred?: boolean;
  archived?: boolean;
  tags?: Array<string | CuboxTag> | null;
  folder?: CuboxFolder | null;
  create_time?: string | null;
  update_time?: string | null;
  content?: string | null;
  author?: string | null;
  annotations?: CuboxAnnotation[] | null;
  insight?: unknown;
}

interface CuboxEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export interface CuboxConfig {
  server: string;
  token: string;
  folderIds: string[];
  tagIds: string[];
  limit: number;
  includeArchived: boolean;
  fetchDetails: boolean;
  sinceDays: number | null;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item] : typeof item === "number" ? [String(item)] : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function extractToken(apiLink: string): string {
  const match = /\/c\/api\/save\/([A-Za-z0-9_-]+)/.exec(apiLink);
  return match ? match[1] : "";
}

function extractServer(apiLink: string): string | null {
  if (!apiLink) return null;
  try {
    const url = new URL(apiLink.includes("://") ? apiLink : `https://${apiLink}`);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function parseCuboxConfig(config: Record<string, unknown>): CuboxConfig {
  const apiLink = typeof config.apiLink === "string" ? config.apiLink.trim() : "";
  const explicitToken = typeof config.token === "string" ? config.token.trim() : "";
  const token = explicitToken || extractToken(apiLink);
  if (!token) {
    throw new Error("请填写 Cubox API 链接（形如 https://cubox.pro/c/api/save/TOKEN）或访问 Token");
  }
  const explicitServer =
    typeof config.server === "string" && config.server.trim()
      ? config.server
          .trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/.*$/, "")
          .toLowerCase()
      : "";
  const server = explicitServer || extractServer(apiLink) || DEFAULT_SERVER;
  const sinceDaysRaw = numberOption(config.sinceDays, 0, 1, 3650);
  return {
    server,
    token,
    folderIds: readStringList(config.folderIds),
    tagIds: readStringList(config.tagIds),
    limit: Math.floor(numberOption(config.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)),
    includeArchived: config.includeArchived === true || config.includeArchived === "true",
    fetchDetails: !(config.fetchDetails === false || config.fetchDetails === "false"),
    sinceDays: sinceDaysRaw > 0 ? sinceDaysRaw : null,
  };
}

/** Cubox expects local (+0800) timestamps such as `2026-10-23T22:32:11.614+0800`. */
export function formatCuboxTime(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 23)}+0800`;
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("同步已取消");
}

function sanitize(message: string, config: CuboxConfig): string {
  if (!config.token) return message;
  return message.split(config.token).join("***");
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new Error("同步已取消"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("同步已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class CuboxRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "CuboxRequestError";
    this.retryable = retryable;
  }
}

async function cuboxRequest<T>(
  config: CuboxConfig,
  path: string,
  init: { method?: string; body?: unknown },
  signal: AbortSignal,
): Promise<T> {
  const url = `https://${config.server}/c/api/cli${path}`;
  let lastError: CuboxRequestError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    ensureNotAborted(signal);
    try {
      const response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new CuboxRequestError(
          `Cubox 接口返回 HTTP ${response.status}${response.status === 401 ? "（Token 无效或已过期）" : ""}`,
          response.status >= 500 || response.status === 429,
        );
      }
      let payload: CuboxEnvelope<T>;
      try {
        payload = JSON.parse(text) as CuboxEnvelope<T>;
      } catch {
        throw new CuboxRequestError("Cubox 接口返回了无法解析的数据", true);
      }
      if (typeof payload.code === "number" && payload.code !== 200) {
        const retryable = payload.code >= 500 || payload.code === 429;
        throw new CuboxRequestError(
          `Cubox 接口错误（${payload.code}）：${payload.message || "未知错误"}`,
          retryable,
        );
      }
      return payload.data as T;
    } catch (error) {
      if (signal.aborted) throw new Error("同步已取消");
      const isAbort =
        error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      if (isAbort) {
        lastError = new CuboxRequestError(`Cubox 请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`, true);
      } else if (error instanceof CuboxRequestError) {
        lastError = error;
      } else if (error instanceof Error) {
        lastError = new CuboxRequestError(`无法连接 Cubox：${error.message}`, true);
      } else {
        lastError = new CuboxRequestError(`无法连接 Cubox：${String(error)}`, true);
      }
      if (!lastError.retryable || attempt >= MAX_RETRIES) break;
      await delay(400 * 2 ** attempt, signal);
    }
  }

  const message = lastError?.message ?? "Cubox 请求失败";
  throw new Error(sanitize(message, config));
}

async function fetchFolders(config: CuboxConfig, signal: AbortSignal): Promise<CuboxFolder[]> {
  const data = await cuboxRequest<CuboxFolder[] | null>(config, "/folder/list", {}, signal);
  return Array.isArray(data) ? data : [];
}

async function fetchCards(
  config: CuboxConfig,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CuboxCard[]> {
  const data = await cuboxRequest<unknown>(config, "/card/filter", { method: "POST", body }, signal);
  if (Array.isArray(data)) return data as CuboxCard[];
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["list", "cards", "items"]) {
      if (Array.isArray(record[key])) return record[key] as CuboxCard[];
    }
  }
  throw new Error("Cubox 收藏列表格式无效，已停止同步以保留历史数据");
}

async function fetchCardDetail(
  config: CuboxConfig,
  id: string,
  signal: AbortSignal,
): Promise<CuboxCard | null> {
  const data = await cuboxRequest<CuboxCard | null>(
    config,
    `/card/detail?id=${encodeURIComponent(id)}`,
    {},
    signal,
  );
  return data && typeof data === "object" ? data : null;
}

function normalizeTags(tags: CuboxCard["tags"]): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .map((tag) => {
          if (typeof tag === "string") return tag.trim();
          if (tag && typeof tag === "object") {
            return String(tag.nested_name ?? tag.name ?? "").trim();
          }
          return "";
        })
        .filter(Boolean),
    ),
  ];
}

function firstLine(value: string | null | undefined, maxLength: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function pickTitle(card: CuboxCard): string {
  const candidates = [card.title, card.article_title, firstLine(card.description, 60)];
  for (const candidate of candidates) {
    const text = (candidate ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "Cubox 收藏";
}

function cardMetadata(card: CuboxCard): Record<string, unknown> {
  return {
    folder: card.folder?.nested_name || card.folder?.name || null,
    folderId: card.folder?.id ?? null,
    domain: card.domain ?? null,
    starred: Boolean(card.starred),
    read: Boolean(card.read),
    archived: Boolean(card.archived),
  };
}

function buildItem(card: CuboxCard, config: CuboxConfig, signal: AbortSignal): ScanItem {
  const title = pickTitle(card);
  const tags = normalizeTags(card.tags);
  const baseTags = tags;

  const load = async (): Promise<LoadedContent> => {
    ensureNotAborted(signal);
    let detailed: CuboxCard = card;
    let detailFetched = false;
    if (config.fetchDetails) {
      const detail = await fetchCardDetail(config, card.id, signal);
      if (detail) {
        detailed = { ...card, ...detail };
        detailFetched = true;
      }
    }

    const description = (detailed.description ?? card.description ?? "").trim();
    const body = (detailed.content ?? "").trim();
    const annotations = Array.isArray(detailed.annotations) ? detailed.annotations : [];
    const insight = extractInsight(detailed.insight);
    const sections: string[] = [];
    if (body) sections.push(body);
    if (annotations.length > 0) sections.push(renderAnnotations(annotations));
    if (insight) sections.push(`## AI 摘要\n\n${insight}`);
    if (sections.length === 0) {
      sections.push(description);
    }
    const mergedTags = normalizeTags([...(baseTags as unknown as CuboxTag[]), ...(detailed.tags ?? [] as unknown as CuboxTag[])]);

    return {
      title: pickTitle(detailed),
      description: description || firstLine(card.article_title, 200) || undefined,
      author: (detailed.author ?? "").trim() || undefined,
      url: detailed.url ?? card.url ?? undefined,
      mimeType: "text/markdown",
      content: sections.join("\n\n---\n\n"),
      contentFormat: "markdown",
      publishedAt: detailed.create_time ?? card.create_time ?? null,
      sourceCreatedAt: detailed.create_time ?? card.create_time ?? null,
      sourceUpdatedAt: detailed.update_time ?? card.update_time ?? null,
      tags: mergedTags,
      metadata: {
        ...cardMetadata(detailed),
        annotationCount: annotations.length,
        hasInsight: Boolean(insight),
        detailFetched,
      },
    };
  };

  return {
    externalId: card.id,
    kind: card.url ? "article" : "note",
    title,
    description: (card.description ?? "").trim() || null,
    author: (card.author ?? "").trim() || null,
    url: card.url ?? null,
    mimeType: "text/markdown",
    publishedAt: card.create_time ?? null,
    sourceCreatedAt: card.create_time ?? null,
    sourceUpdatedAt: card.update_time ?? null,
    tags,
    metadata: cardMetadata(card),
    load,
  };
}

function extractInsight(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => extractInsight(item, depth + 1))
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["summary", "content", "text", "insight"]) {
      const found = extractInsight(record[key], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function renderAnnotations(annotations: CuboxAnnotation[]): string {
  const lines: string[] = ["## 高亮与笔记"];
  annotations.forEach((annotation, index) => {
    const text = (annotation.text ?? "").trim();
    const note = (annotation.note ?? "").trim();
    const image = (annotation.image_url ?? "").trim();
    if (!text && !note && !image) return;
    lines.push("");
    lines.push(`### 标注 ${index + 1}`);
    if (text) {
      for (const line of text.split(/\r?\n/)) lines.push(`> ${line}`);
    }
    if (note) lines.push(`\n**笔记：** ${note}`);
    if (image) lines.push(`\n![标注图片](${image})`);
    const meta = [annotation.color, annotation.create_time].filter(Boolean).join(" · ");
    if (meta) lines.push(`\n*${meta}*`);
  });
  return lines.length > 1 ? lines.join("\n") : "";
}

const connector: Connector = {
  type: "cubox",
  label: "Cubox",
  description: "通过 Cubox 开放接口同步收藏、正文、高亮与 AI 摘要",
  async test(config) {
    let parsed: CuboxConfig;
    try {
      parsed = parseCuboxConfig(config);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Cubox 配置不完整" };
    }
    const controller = new AbortController();
    try {
      const folders = await fetchFolders(parsed, controller.signal);
      const samples = folders.slice(0, 5).map((folder) => folder.nested_name || folder.name || "");
      return {
        ok: true,
        message: `连接成功，共 ${folders.length} 个收藏夹`,
        meta: {
          server: parsed.server,
          folderCount: folders.length,
          samples: samples.filter(Boolean),
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: sanitize(error instanceof Error ? error.message : "无法连接 Cubox", parsed),
        meta: { server: parsed.server },
      };
    }
  },
  async *scan(config, ctx: SyncContext): AsyncGenerator<ScanItem, ScanSummary> {
    const parsed = parseCuboxConfig(config);
    const startedAt = Date.now();
    const now = new Date();
    const startTime =
      parsed.sinceDays !== null
        ? formatCuboxTime(new Date(now.getTime() - parsed.sinceDays * 24 * 60 * 60 * 1000))
        : null;

    let cursor: string | null = null;
    let fetched = 0;
    let complete = true;
    const seen = new Set<string>();
    let pages = 0;

    while (fetched < parsed.limit) {
      ensureNotAborted(ctx.signal);
      const pageSize = Math.min(PAGE_SIZE, parsed.limit - fetched);
      const body: Record<string, unknown> = {
        limit: pageSize,
        ...(cursor ? { last_card_id: cursor } : {}),
        ...(parsed.folderIds.length > 0 ? { folder_filters: parsed.folderIds } : {}),
        ...(parsed.tagIds.length > 0 ? { tag_filters: parsed.tagIds } : {}),
        ...(parsed.includeArchived ? {} : { archived: false }),
        ...(startTime ? { start_time: startTime } : {}),
      };
      const cards = await fetchCards(parsed, body, ctx.signal);
      pages += 1;
      if (cards.length === 0) break;

      for (const card of cards) {
        if (!card || !card.id) throw new Error("Cubox 收藏缺少 ID，已停止同步");
        if (seen.has(card.id)) continue;
        if (fetched >= parsed.limit) {
          complete = false;
          break;
        }
        seen.add(card.id);
        fetched += 1;
        if (fetched % 10 === 0) {
          ctx.onProgress({ processed: fetched, current: pickTitle(card) });
        }
        yield buildItem(card, parsed, ctx.signal);
      }

      if (!complete) break;
      const lastCard = cards[cards.length - 1];
      const nextCursor = lastCard?.id ?? null;
      if (!nextCursor || nextCursor === cursor) {
        complete = false;
        break;
      }
      cursor = nextCursor;
      if (cards.length < pageSize) {
        complete = true;
        break;
      }
      if (fetched >= parsed.limit) {
        complete = false;
        break;
      }
    }
    ctx.onProgress({ processed: fetched });

    const notes: string[] = [];
    if (!complete) {
      notes.push(`扫描范围可能不完整（上限 ${parsed.limit} 条），未清理历史收藏；请调高 limit 获取更多内容`);
    }
    if (startTime) {
      notes.push(`仅同步 ${parsed.sinceDays} 天内的收藏`);
    }
    if (fetched === 0) {
      notes.push("没有符合条件的 Cubox 收藏");
    } else {
      notes.push(`用时 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒`);
    }
    for (const line of notes) ctx.log(`Cubox：${line}`);

    return {
      complete: complete && startTime === null,
      scanned: fetched,
      skipped: 0,
      note: notes.join("；"),
    };
  },
};

export default connector;
