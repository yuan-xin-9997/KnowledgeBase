import { useState } from "react";
import { Loader2, PlugZap } from "lucide-react";
import type { Source, SourceType } from "../../lib/types";
import { api } from "../../lib/api";
import { configListText, describeApiError, fallbackSourceTypes } from "./sourceUtils";

interface ConfigField { key: string; label: string; kind?: "password" | "number" | "list"; required?: boolean; placeholder?: string; initial?: string | number; min?: number; max?: number }
const fileFields: ConfigField[] = [
  { key: "includeExtensions", label: "文件扩展名（留空使用默认类型）", kind: "list", placeholder: "pdf, docx, xlsx, pptx, md, txt" },
  { key: "excludeGlobs", label: "排除路径 / 文件名", kind: "list", placeholder: "*.tmp, **/cache/**" },
  { key: "maxFiles", label: "单次文件上限", kind: "number", initial: 20000, min: 1, max: 500000 },
  { key: "maxFileSizeMb", label: "正文抽取大小上限（MB）", kind: "number", initial: 100, min: 1, max: 2048 },
];
const fields: Record<SourceType, ConfigField[]> = {
  local: [{ key: "path", label: "服务器目录 / UNC 路径", required: true, placeholder: "例如 /mnt/nas/专业资料 或 \\\\nas\\share\\资料" }, ...fileFields],
  smb: [{ key: "host", label: "SMB 主机", required: true, placeholder: "192.168.0.100" }, { key: "share", label: "共享名称", required: true, placeholder: "personal_folder" }, { key: "username", label: "用户名", required: true }, { key: "password", label: "密码", kind: "password" }, { key: "domain", label: "域（可选）" }, { key: "basePath", label: "共享内子目录（可选）" }, ...fileFields, { key: "maxCacheSizeMb", label: "原件缓存上限（MB）", kind: "number", initial: 1024, min: 1, max: 102400 }],
  cubox: [{ key: "apiLink", label: "Cubox API 扩展链接", kind: "password", required: true, placeholder: "https://cubox.pro/c/api/save/…" }, { key: "limit", label: "单次同步上限", kind: "number", initial: 500, min: 1, max: 5000 }, { key: "sinceDays", label: "最近天数（0 表示不限）", kind: "number", initial: 0, min: 0, max: 3650 }, { key: "folderIds", label: "收藏夹 ID（可选，逗号分隔）", kind: "list" }, { key: "tagIds", label: "标签 ID（可选，逗号分隔）", kind: "list" }],
  yuque: [{ key: "token", label: "语雀 Token", kind: "password", required: true }, { key: "login", label: "账号 / 团队登录名（留空自动识别）" }, { key: "repoIds", label: "知识库范围（留空为全部）", kind: "list", placeholder: "user/repo, group/repo" }, { key: "maxDocs", label: "单次文档上限", kind: "number", initial: 5000, min: 1, max: 100000 }],
};
const booleanFields: Record<SourceType, Array<{ key: string; label: string; initial: boolean }>> = {
  local: [{ key: "followSymlinks", label: "跟随符号链接", initial: false }], smb: [],
  cubox: [{ key: "fetchDetails", label: "同步完整正文、高亮与 AI 解读", initial: true }, { key: "includeArchived", label: "包含已归档收藏", initial: false }],
  yuque: [{ key: "includePublic", label: "包含公开知识库", initial: true }],
};
function initialConfig(source: Source | null, type: SourceType): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields[type]) {
    result[field.key] = field.kind === "password" ? "" : field.kind === "list" ? configListText(source?.config ?? {}, field.key) : source?.config[field.key] ?? field.initial ?? "";
  }
  for (const field of booleanFields[type]) result[field.key] = source?.config[field.key] ?? field.initial;
  return result;
}

export default function SourceEditor({ source, isAdmin, onSaved, onCancel }: { source: Source | null; isAdmin: boolean; onSaved: () => void; onCancel: () => void }) {
  const [type, setType] = useState<SourceType>(source?.type ?? (isAdmin ? "local" : "cubox"));
  const [name, setName] = useState(source?.name ?? "");
  const [config, setConfig] = useState(() => initialConfig(source, source?.type ?? (isAdmin ? "local" : "cubox")));
  const [interval, setInterval] = useState(source?.syncIntervalMinutes ?? 360);
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const change = (key: string, value: unknown) => { setConfig((previous) => ({ ...previous, [key]: value })); setResult(null); };
  const test = async () => {
    setTesting(true); setError(""); setResult(null);
    try { setResult(await api.sources.test({ type, config, sourceId: source?.id })); }
    catch (reason) { setError(describeApiError(reason)); }
    finally { setTesting(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const input = { name, config, enabled, syncIntervalMinutes: interval };
      if (source) await api.sources.update(source.id, input);
      else await api.sources.create({ ...input, type });
      onSaved();
    } catch (reason) { setError(describeApiError(reason)); }
    finally { setBusy(false); }
  };
  return <form className="card mb-6 p-5 sm:p-6" onSubmit={save} aria-label={source ? "编辑来源" : "添加来源"}>
    <h2 className="font-display text-lg font-semibold">{source ? "编辑信息来源" : "连接新的信息来源"}</h2>
    <p className="mb-5 mt-1 text-xs text-[var(--muted)]">保存后点击「同步」，内容会进入知识库。密码与 Token 编辑时留空即可保留。</p>
    <fieldset disabled={busy || testing} className="grid gap-4 md:grid-cols-2">
      <label className="field"><span className="label">来源名称</span><input required autoFocus maxLength={100} className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：NAS 专业资料" /></label>
      <label className="field"><span className="label">来源类型</span><select className="select" disabled={Boolean(source)} value={type} onChange={(event) => { const next = event.target.value as SourceType; setType(next); setConfig(initialConfig(null, next)); setResult(null); }}>{fallbackSourceTypes.filter((item) => isAdmin || item.type !== "local").map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label>
      {!isAdmin && <p className="md:col-span-2 text-xs text-[var(--muted)]">服务器本地目录由管理员接入。你可以连接自己的 SMB 共享、Cubox 或语雀。</p>}
      {fields[type].map((field) => <label key={field.key} className={`field ${field.key === "path" || field.key === "apiLink" ? "md:col-span-2" : ""}`}><span className="label">{field.label}</span><input className="input" type={field.kind === "number" ? "number" : field.kind === "password" ? "password" : "text"} autoComplete={field.kind === "password" ? "new-password" : "off"} required={field.required && !(source && field.kind === "password")} min={field.min} max={field.max} placeholder={field.kind === "password" && source?.config[field.key] ? "已配置，留空保留" : field.placeholder} value={String(config[field.key] ?? "")} onChange={(event) => change(field.key, field.kind === "number" ? Number(event.target.value) : event.target.value)} /></label>)}
      {type === "cubox" && <p className="md:col-span-2 text-xs leading-5 text-[var(--muted)]">在 Cubox「偏好设置 → 扩展中心和自动化 → API 扩展」中复制链接。该链接包含访问凭证。</p>}
      {type === "smb" && <p className="md:col-span-2 text-xs leading-5 text-[var(--muted)]">原件缓存达到上限后，正文仍会入库，未缓存的附件暂不可下载。提高缓存上限后点击「全量重同步」即可补齐。</p>}
      <label className="field"><span className="label">自动同步间隔（分钟，0 为仅手动）</span><input className="input" type="number" min={0} max={43200} required value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></label>
      <div className="flex flex-col justify-center gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用此来源</label>{booleanFields[type].map((field) => <label key={field.key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(config[field.key])} onChange={(event) => change(field.key, event.target.checked)} />{field.label}</label>)}</div>
    </fieldset>
    {error && <p role="alert" className="mt-4 break-words text-sm text-[var(--danger)]">{error}</p>}
    {result && <p role="status" className={`mt-4 break-words text-sm ${result.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{result.ok ? "连接成功：" : "连接失败："}{result.message}</p>}
    <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy || testing} type="submit" className="btn btn-accent">{busy && <Loader2 size={14} className="spin" />}保存来源</button><button type="button" disabled={busy || testing} className="btn btn-ghost" onClick={() => void test()}>{testing ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}测试连接</button><button type="button" disabled={busy || testing} className="btn btn-ghost" onClick={onCancel}>取消</button></div>
  </form>;
}
