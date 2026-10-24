import type { Connector, ScanItem, SyncContext } from "./types.js";
import { htmlToText } from "./extract.js";

interface YuqueConfig { token: string; login: string; repoIds: string[]; maxDocs: number; includePublic: boolean }
interface User { login: string; name?: string }
interface Repo { id: number; namespace: string; name: string; public?: number }
interface Doc { id: number; slug: string; title: string; description?: string; body?: string; body_html?: string; body_draft?: string; created_at?: string; updated_at?: string; content_updated_at?: string; published_at?: string; user?: User }

export function parseYuqueConfig(config: Record<string, unknown>): YuqueConfig {
  const token = typeof config.token === "string" ? config.token.trim() : "";
  if (!token) throw new Error("请填写语雀个人 Token");
  const list = Array.isArray(config.repoIds) ? config.repoIds : typeof config.repoIds === "string" ? config.repoIds.split(/[,;\s]+/) : [];
  const repoIds = list.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean);
  if (repoIds.some(v => !/^(?:\d+|[^/\s]+\/[^/\s]+)$/.test(v))) throw new Error("语雀知识库需填写 ID 或 user/repo");
  const max = Number(config.maxDocs ?? 5000);
  return { token, login: typeof config.login === "string" ? config.login.trim() : "", repoIds, maxDocs: Number.isFinite(max) && max > 0 ? Math.min(50_000, Math.floor(max)) : 5000, includePublic: config.includePublic !== false && config.includePublic !== "false" };
}

// API contract: https://github.com/yuque/openapi-metadata/blob/master/yuque.tea
async function request<T>(config: YuqueConfig, pathname: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://www.yuque.com/api/v2${pathname}`, {
      headers: { "X-Auth-Token": config.token, "User-Agent": "KnowledgeBase/1.0", Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw new Error("同步已取消");
    throw new Error(`无法连接语雀：${error instanceof Error ? error.message.split(config.token).join("***") : "请求失败"}`);
  }
  if (!response.ok) throw new Error(`语雀接口返回 HTTP ${response.status}${[401, 403].includes(response.status) ? "（请检查 Token、权限及账号开放 API 资格）" : ""}`);
  const payload = await response.json() as { data?: T; status?: number };
  if (payload.data === undefined || payload.data === null) throw new Error("语雀接口未返回有效数据");
  return payload.data;
}

function repoPath(repoId: string): string { return repoId.split("/").map(encodeURIComponent).join("/"); }

async function repositories(config: YuqueConfig, signal: AbortSignal): Promise<Repo[]> {
  if (config.repoIds.length) {
    const result: Repo[] = [];
    for (const repoId of config.repoIds) result.push(await request<Repo>(config, `/repos/${repoPath(repoId)}`, signal));
    return result;
  }
  const login = config.login || (await request<User>(config, "/user", signal)).login;
  const result: Repo[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await request<Repo[]>(config, `/users/${encodeURIComponent(login)}/repos?offset=${offset}&limit=100&type=Book`, signal);
    if (!Array.isArray(page)) throw new Error("语雀知识库列表格式无效");
    result.push(...page);
    if (page.length < 100) return result;
  }
}

function buildItem(doc: Doc, repo: Repo, config: YuqueConfig, signal: AbortSignal): ScanItem {
  const url = `https://www.yuque.com/${repo.namespace}/${encodeURIComponent(doc.slug)}`;
  return {
    externalId: `${repo.id}/${doc.id}`, kind: "article", title: doc.title, description: doc.description,
    url, mimeType: "text/markdown", sourceCreatedAt: doc.created_at, sourceUpdatedAt: doc.content_updated_at || doc.updated_at,
    publishedAt: doc.published_at, metadata: { repository: repo.name, namespace: repo.namespace },
    async load() {
      const detail = await request<Doc>(config, `/repos/${repo.id}/docs/${doc.id}?raw=1`, signal);
      const markdown = detail.body || detail.body_draft;
      const content = markdown || (detail.body_html ? htmlToText(detail.body_html).text : detail.description || "");
      return { title: detail.title || doc.title, content, contentFormat: markdown ? "markdown" : "text", author: detail.user?.name || detail.user?.login, sourceCreatedAt: detail.created_at, sourceUpdatedAt: detail.content_updated_at || detail.updated_at, publishedAt: detail.published_at };
    },
  };
}

const connector: Connector = {
  type: "yuque", label: "语雀", description: "用 Token 同步语雀知识库文档",
  async test(config) {
    try {
      const parsed = parseYuqueConfig(config);
      const user = await request<User>(parsed, "/user", new AbortController().signal);
      const repos = await repositories(parsed, new AbortController().signal);
      return { ok: true, message: `连接成功，账号 ${user.name || user.login}，${repos.length} 个知识库`, meta: { login: user.login, repositoryCount: repos.length } };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "无法连接语雀" }; }
  },
  async *scan(config, ctx: SyncContext) {
    const parsed = parseYuqueConfig(config);
    const repos = await repositories(parsed, ctx.signal);
    let scanned = 0;
    const seen = new Set<string>();
    for (const repo of repos) {
      if (!parsed.includePublic && repo.public === 1) continue;
      for (let offset = 0; ; offset += 100) {
        const docs = await request<Doc[]>(parsed, `/repos/${repo.id}/docs?offset=${offset}&limit=100`, ctx.signal);
        if (!Array.isArray(docs)) throw new Error("语雀文档列表格式无效");
        for (const doc of docs) {
          if (ctx.signal.aborted) throw new Error("同步已取消");
          const key = `${repo.id}/${doc.id}`;
          if (seen.has(key)) continue;
          if (scanned >= parsed.maxDocs) return { complete: false, scanned, note: `已达到同步上限 ${parsed.maxDocs} 篇，未清理历史文档` };
          seen.add(key);
          scanned += 1;
          ctx.onProgress({ processed: scanned, current: doc.title });
          yield buildItem(doc, repo, parsed, ctx.signal);
        }
        if (docs.length < 100) break;
      }
    }
    return { complete: true, scanned };
  },
};

export default connector;
