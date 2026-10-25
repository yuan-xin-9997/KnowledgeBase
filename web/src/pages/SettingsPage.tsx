import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Cpu, Plus, Pencil, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import AccountSettings from "../components/AccountSettings";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import type { Provider } from "../lib/types";
import { describeApiError } from "../components/sources/sourceUtils";

const blank = () => ({ name: "", protocol: "openai" as Provider["protocol"], baseUrl: "", apiKey: "", model: "", temperature: 0.7, maxTokens: 4096 });

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const { toast } = useToast();

  const load = async () => {
    try { setProviders((await api.providers.list()).providers); }
    catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const edit = (provider: Provider | null) => {
    setEditing(provider);
    setDraft(provider ? { name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, apiKey: "", model: provider.model, temperature: provider.temperature, maxTokens: provider.maxTokens } : blank());
    setError(""); setOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (editing) await api.providers.update(editing.id, draft);
      else await api.providers.create(draft);
      setOpen(false); setDraft(blank()); toast("模型配置已保存", "success"); await load();
    } catch (reason) { setError(describeApiError(reason)); }
    finally { setBusy(false); }
  };
  const test = async (provider: Provider) => {
    setTesting(provider.id);
    try {
      const result = await api.providers.test(provider.id);
      setTestResults((previous) => ({ ...previous, [provider.id]: result }));
      toast(result.message, result.ok ? "success" : "error");
    } catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setTesting(null); }
  };
  const remove = async (provider: Provider) => {
    if (!window.confirm(`删除模型「${provider.name}」？已有会话仍会保留，需要重新选择模型。`)) return;
    try { await api.providers.remove(provider.id); await load(); toast("模型已删除", "success"); }
    catch (reason) { toast(describeApiError(reason), "error"); }
  };
  return (
    <div>
      <PageHeader eyebrow="Settings" title="AI 模型" description="连接你选择的大模型服务，在会话中自由切换。" actions={<button className="btn btn-primary btn-sm" onClick={() => edit(null)}><Plus size={14} />添加模型</button>} />
      <div className="px-6 py-7 lg:px-10">
        <div className="mb-6 flex flex-wrap gap-2"><span className="btn btn-accent btn-sm" aria-current="page">AI 模型</span><Link className="btn btn-ghost btn-sm" to="/settings/ai-access">AI 接入</Link></div>
        {open && <form onSubmit={save} className="card mb-6 p-5" aria-label={editing ? "编辑模型" : "添加模型"}>
          <h2 className="mb-5 font-display text-lg font-semibold">{editing ? "编辑模型" : "添加模型"}</h2>
          <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
            <label className="field"><span className="label">配置名称</span><input autoFocus required maxLength={100} className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：我的知识助手" /></label>
            <label className="field"><span className="label">API 协议</span><select className="select" value={draft.protocol} onChange={(e) => setDraft({ ...draft, protocol: e.target.value as Provider["protocol"] })}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 兼容</option></select></label>
            <label className="field"><span className="label">Base URL</span><input required type="url" className="input" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder={draft.protocol === "openai" ? "https://api.example.com/v1" : "https://api.example.com"} /><span className="text-xs text-[var(--muted)]">填写服务商提供的 API 基础地址。</span></label>
            <label className="field"><span className="label">模型 ID</span><input required maxLength={200} className="input" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="服务商提供的模型名称" /></label>
            <label className="field md:col-span-2"><span className="label">API Key{editing ? "（留空保留已保存的密钥）" : ""}</span><input type="password" autoComplete="new-password" required={!editing} maxLength={2000} className="input" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder={editing?.apiKeyMasked || "输入 API Key"} /></label>
            <label className="field"><span className="label">温度</span><input type="number" required min={0} max={2} step={0.1} className="input" value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: Number(e.target.value) })} /></label>
            <label className="field"><span className="label">最大输出 Tokens</span><input type="number" required min={1} max={32768} className="input" value={draft.maxTokens} onChange={(e) => setDraft({ ...draft, maxTokens: Number(e.target.value) })} /></label>
          </fieldset>
          {error && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-5 flex gap-2"><button disabled={busy} className="btn btn-accent">{busy && <Loader2 size={14} className="spin" />}保存模型</button><button disabled={busy} type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setDraft(blank()); }}>取消</button></div>
        </form>}
        {loading ? <Spinner /> : providers.length === 0 ? <EmptyState icon={Cpu} title="还没有配置模型" description="添加兼容 OpenAI 或 Anthropic 协议的模型服务，开始与知识库对话。" action={<button className="btn btn-accent" onClick={() => edit(null)}>添加第一个模型</button>} /> : <div className="grid gap-4 xl:grid-cols-2">
          {providers.map((provider) => <div key={provider.id} className="card p-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="chip chip-accent mb-2">{provider.protocol === "openai" ? "OpenAI 兼容" : "Anthropic 兼容"}</span><h2 className="font-semibold">{provider.name}</h2><p className="mt-1 break-all text-sm text-[var(--muted)]">{provider.model}</p></div><Cpu size={22} className="shrink-0 text-[var(--accent)]" /></div>
            <p className="mt-3 break-all text-xs text-[var(--muted)]">{provider.baseUrl}</p><p className="mt-1 text-xs text-[var(--muted-2)]">密钥 {provider.apiKeyMasked} · 温度 {provider.temperature} · {provider.maxTokens} Tokens</p>
            {testResults[provider.id] && <p role="status" className={`mt-3 break-words text-xs ${testResults[provider.id].ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{testResults[provider.id].message}</p>}
            <div className="mt-5 flex flex-wrap gap-2"><button disabled={testing !== null} className="btn btn-ghost btn-sm" onClick={() => void test(provider)}>{testing === provider.id ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}测试连接</button><button className="btn btn-ghost btn-sm" onClick={() => edit(provider)}><Pencil size={13} />编辑</button><button className="btn btn-ghost btn-sm" onClick={() => void remove(provider)}><Trash2 size={13} />删除</button><Link to="/chat" className="btn btn-accent btn-sm">开始对话</Link></div>
          </div>)}
        </div>}
        <AccountSettings />
      </div>
    </div>
  );
}
