import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clipboard, KeyRound, Loader2, Plus, ShieldCheck, TestTube2, XCircle } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import type { ApiCredentialMetadata, ApiScope } from "../lib/types";
import { describeApiError } from "../components/sources/sourceUtils";

const scopeInfo: Record<ApiScope, { label: string; description: string }> = {
  "documents:read": { label: "读取文档", description: "检索并读取知识库正文。" },
  "sources:read": { label: "查看来源", description: "查看来源名称、状态和脱敏配置。" },
  "sources:write": { label: "管理来源", description: "创建和修改来源；仍受账号角色限制。" },
  "sync:write": { label: "执行同步", description: "启动异步来源同步任务。" },
  "jobs:read": { label: "查看任务", description: "查询同步进度、结果和失败原因。" },
};

function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "永不过期";
}

export default function AiAccessPage() {
  const [items, setItems] = useState<ApiCredentialMetadata[]>([]);
  const [availableScopes, setAvailableScopes] = useState<ApiScope[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [scopes, setScopes] = useState<ApiScope[]>(["documents:read"]);
  const [created, setCreated] = useState<{ id: string; token: string; expiresAt: string | null; scopes: ApiScope[] } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const { toast } = useToast();
  const pageSize = 10;
  const origin = window.location.origin;

  const load = async (targetPage = page) => {
    setLoading(true);
    try {
      const result = await api.apiCredentials.list(targetPage, pageSize);
      setItems(result.credentials.items); setTotal(result.credentials.total);
      setAvailableScopes(result.availableScopes);
    } catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(page); }, [page]);

  const expiresAt = () => expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api.apiCredentials.create({ name, scopes, expiresAt: expiresAt() });
      setCreated(result.credential); setCreating(false); setName(""); setScopes(["documents:read"]); setExpiry("30");
      toast("凭据已创建，请立即保存密钥", "success"); await load(1); setPage(1);
    } catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setBusy(false); }
  };
  const revoke = async (credential: ApiCredentialMetadata) => {
    if (!window.confirm(`撤销凭据「${credential.name}」？该凭据及其派生的短期令牌会立即失效，且无法恢复。`)) return;
    try { await api.apiCredentials.revoke(credential.id); toast("凭据已撤销", "success"); await load(); }
    catch (reason) { toast(describeApiError(reason), "error"); }
  };
  const copySecret = async () => {
    if (!created) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(created.token);
      else {
        const area = document.createElement("textarea");
        area.value = created.token; area.style.position = "fixed"; area.style.opacity = "0";
        document.body.appendChild(area); area.select();
        if (!document.execCommand("copy")) throw new Error("copy failed");
        area.remove();
      }
      toast("密钥已复制，请保存到受保护的凭据存储", "success");
    } catch { toast("浏览器未允许复制，请手动选择并保存密钥", "error"); }
  };
  const testConnection = async () => {
    if (!created) return;
    setTesting(true); setTestResult(null);
    const headers = { Authorization: `Bearer ${created.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
    try {
      const apiResponse = await fetch("/api/v1/documents?pageSize=1", { headers: { Authorization: headers.Authorization } });
      if (!apiResponse.ok && created.scopes.includes("documents:read")) throw new Error(`API 鉴权失败（${apiResponse.status}）`);
      const initialize = await fetch("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zhiyu-web-test", version: "1.0.0" } } }) });
      const initBody = await initialize.json();
      if (!initialize.ok || !initBody.result?.serverInfo) throw new Error(`MCP initialize 失败（${initialize.status}）`);
      const listed = await fetch("/mcp", { method: "POST", headers: { ...headers, "MCP-Protocol-Version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
      const listBody = await listed.json();
      if (!listed.ok || !Array.isArray(listBody.result?.tools)) throw new Error(`MCP tools/list 失败（${listed.status}）`);
      const queryTool = created.scopes.includes("sources:read") ? { name: "list_sources", arguments: {} }
        : created.scopes.includes("documents:read") ? { name: "search_documents", arguments: { page: 1, pageSize: 1 } } : null;
      if (queryTool) {
        const called = await fetch("/mcp", { method: "POST", headers: { ...headers, "MCP-Protocol-Version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: queryTool }) });
        const callBody = await called.json();
        if (!called.ok || callBody.result?.isError) throw new Error(`MCP 查询工具失败（${called.status}）`);
      }
      setTestResult({ ok: true, message: `认证成功；发现 ${listBody.result.tools.length} 个工具${queryTool ? "；查询工具调用成功" : "；当前权限未包含只读业务调用"}。` });
    } catch (reason) { setTestResult({ ok: false, message: reason instanceof Error ? reason.message : "连接测试失败" }); }
    finally { setTesting(false); }
  };
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const curlExample = useMemo(() => `export KB_TOKEN='从受保护的凭据存储读取'\ncurl '${origin}/api/v1/documents?pageSize=10' \\\n  -H "Authorization: Bearer $KB_TOKEN"`, [origin]);

  return <div>
    <PageHeader eyebrow="Settings · AI Access" title="AI 接入" description="为 AI 和自动化程序创建独立、可撤销、最小权限的访问凭据。" actions={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} />创建凭据</button>} />
    <div className="px-6 py-7 lg:px-10">
      <div className="mb-6 flex flex-wrap gap-2"><a className="btn btn-ghost btn-sm" href="/settings">AI 模型</a><span className="btn btn-accent btn-sm" aria-current="page">AI 接入</span></div>

      {created && <section className="card mb-6 border border-[var(--accent)] p-5" aria-label="新凭据密钥">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-lg font-semibold">立即保存完整密钥</h2><p className="mt-1 text-sm text-[var(--danger)]">关闭后无法再次查看。遗失时请撤销旧凭据并重新创建。</p></div><button className="btn btn-ghost btn-sm" onClick={() => { setCreated(null); setTestResult(null); }}>我已保存并关闭</button></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-[var(--paper)] p-3 text-sm">{created.token}</code><button className="btn btn-accent" onClick={() => void copySecret()}><Clipboard size={15} />复制密钥</button></div>
        <p className="mt-3 text-xs text-[var(--muted)]">密钥仅暂存在当前页面内存，不会写入浏览器存储、URL 或下载文件。有效期：{dateTime(created.expiresAt)}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2"><button disabled={testing} className="btn btn-ghost btn-sm" onClick={() => void testConnection()}>{testing ? <Loader2 className="spin" size={14} /> : <TestTube2 size={14} />}无副作用连接测试</button>{testResult && <span role="status" className={`text-sm ${testResult.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{testResult.ok ? <CheckCircle2 className="mr-1 inline" size={14} /> : <XCircle className="mr-1 inline" size={14} />}{testResult.message}</span>}</div>
      </section>}

      {creating && <form className="card mb-6 p-5" onSubmit={submit} aria-label="创建 AI 接入凭据">
        <h2 className="font-display text-lg font-semibold">创建凭据</h2><p className="mt-1 text-sm text-[var(--muted)]">默认只授予读取文档权限。需要写操作时再单独勾选。</p>
        <fieldset disabled={busy} className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="field"><span className="label">名称</span><input autoFocus required maxLength={100} className="input" value={name} onChange={event => setName(event.target.value)} placeholder="例如：Claude Desktop" /></label>
          <label className="field"><span className="label">有效期</span><select className="select" value={expiry} onChange={event => setExpiry(event.target.value)}><option value="30">30 天（推荐）</option><option value="90">90 天</option><option value="365">1 年</option><option value="never">永不过期</option></select></label>
          <div className="md:col-span-2"><span className="label">权限范围</span><div className="mt-2 grid gap-3 md:grid-cols-2">{availableScopes.map(scope => <label key={scope} className="card flex cursor-pointer gap-3 p-3"><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter(item => item !== scope))} /><span><strong className="text-sm">{scopeInfo[scope].label}</strong><small className="mt-1 block text-[var(--muted)]">{scopeInfo[scope].description} <code>{scope}</code></small></span></label>)}</div></div>
        </fieldset>
        <div className="mt-5 flex gap-2"><button disabled={busy || scopes.length === 0} className="btn btn-accent">{busy && <Loader2 className="spin" size={14} />}创建并显示一次密钥</button><button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>取消</button></div>
      </form>}

      <section className="card mb-6 p-5"><div className="flex items-center gap-2"><ShieldCheck size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">接入地址</h2></div><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-[var(--muted)]">API</dt><dd><code>{origin}/api/v1</code></dd></div><div><dt className="text-[var(--muted)]">OpenAPI</dt><dd><a className="link" href="/api/openapi.json" target="_blank" rel="noreferrer">{origin}/api/openapi.json</a></dd></div><div><dt className="text-[var(--muted)]">MCP Streamable HTTP</dt><dd><code>{origin}/mcp</code></dd></div></dl><pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--paper)] p-4 text-xs"><code>{curlExample}</code></pre><p className="mt-3 text-xs text-[var(--muted)]">支持官方 MCP TypeScript/Python SDK、MCP Inspector，以及支持 Bearer Header 或 OAuth client_credentials 的远程客户端。短期令牌由客户端通过 OAuth 自动获取和续取。</p></section>

      <section><div className="mb-4 flex items-end justify-between"><div><h2 className="font-display text-lg font-semibold">我的凭据</h2><p className="text-sm text-[var(--muted)]">仅显示非敏感前缀和元数据，不可重新查看完整密钥。</p></div><span className="text-xs text-[var(--muted)]">共 {total} 个</span></div>
        {loading ? <Spinner /> : items.length === 0 ? <EmptyState icon={KeyRound} title="还没有 AI 接入凭据" description="创建一个最小权限凭据，用于 API 或 MCP 客户端。" action={<button className="btn btn-accent" onClick={() => setCreating(true)}>创建第一个凭据</button>} /> : <div className="grid gap-3">{items.map(item => <article key={item.id} className="card p-4"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.name}</h3><span className={`chip ${item.status === "active" ? "chip-accent" : ""}`}>{item.status === "active" ? "有效" : item.status === "expired" ? "已过期" : "已撤销"}</span></div><p className="mt-2 text-xs text-[var(--muted)]">标识 {item.tokenPrefix}… · 创建于 {dateTime(item.createdAt)} · 过期时间 {dateTime(item.expiresAt)}</p><div className="mt-3 flex flex-wrap gap-1">{item.scopes.map(scope => <span key={scope} className="chip">{scopeInfo[scope]?.label || scope}</span>)}</div>{item.lastUsedAt && <p className="mt-2 text-xs text-[var(--muted-2)]">最后使用：{dateTime(item.lastUsedAt)}</p>}</div>{item.status === "active" && <button className="btn btn-ghost btn-sm text-[var(--danger)]" onClick={() => void revoke(item)}>撤销</button>}</div></article>)}</div>}
        {maxPage > 1 && <div className="mt-4 flex items-center justify-end gap-2"><button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button><span className="text-sm text-[var(--muted)]">{page} / {maxPage}</span><button className="btn btn-ghost btn-sm" disabled={page >= maxPage} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
      </section>
    </div>
  </div>;
}
