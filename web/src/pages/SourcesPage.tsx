import SyncJobDetails from "../components/sources/SyncJobDetails";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Plus, RefreshCw, Pencil, Trash2, PlugZap, History, StopCircle } from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import Spinner from "../components/Spinner";
import SourceEditor from "../components/sources/SourceEditor";
import { describeApiError, formatAbsoluteTime, formatStatsSummary, jobStatusMeta, sourceLocation, sourceStatus, syncIntervalLabel } from "../components/sources/sourceUtils";
import { api } from "../lib/api";
import type { Source, SyncJob } from "../lib/types";
import { formatNumber, relativeTime, sourceTypeLabel } from "../lib/format";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [historySource, setHistorySource] = useState<Source | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const load = useCallback(async () => {
    try { setSources((await api.sources.list()).sources); setError(""); }
    catch (reason) { setError(describeApiError(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 4000); return () => window.clearInterval(timer); }, [load]);
  const edit = (source: Source | null) => { setEditing(source); setEditorOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const act = async (source: Source, action: "sync" | "force" | "test" | "cancel" | "delete" | "toggle") => {
    if (action === "delete" && !window.confirm(`删除「${source.name}」及已收录的文档？原始资料不会被删除。`)) return;
    setBusy(source.id);
    try {
      if (action === "test") { const result = await api.sources.testExisting(source.id); toast(result.message, result.ok ? "success" : "error"); }
      else if (action === "delete") { await api.sources.remove(source.id); toast("来源已删除", "success"); }
      else if (action === "cancel") { await api.sources.cancel(source.id); toast("已请求取消同步", "info"); }
      else if (action === "toggle") { await api.sources.update(source.id, { enabled: !source.enabled }); }
      else { await api.sources.sync(source.id, action === "force"); toast(`已开始${action === "force" ? "全量" : ""}同步「${source.name}」`, "success"); }
      await load();
    } catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setBusy(null); }
  };
  const history = async (source: Source) => {
    setHistorySource(source); setJobs([]); setJobsLoading(true);
    try { setJobs((await api.sources.jobs(source.id)).jobs); }
    catch (reason) { toast(describeApiError(reason), "error"); }
    finally { setJobsLoading(false); }
  };
  return <div>
    <PageHeader eyebrow="Sources" title="信息来源" description="连接 NAS、SMB、Cubox、语雀，持续汇集你的知识。" actions={<button className="btn btn-primary btn-sm" onClick={() => edit(null)}><Plus size={14} />添加来源</button>} />
    <div className="px-6 py-7 lg:px-10">
      {editorOpen && <SourceEditor key={editing?.id ?? "new"} source={editing} isAdmin={isAdmin} onCancel={() => setEditorOpen(false)} onSaved={() => { setEditorOpen(false); setEditing(null); toast("来源已保存，点击同步开始收录", "success"); void load(); }} />}
      {error && <p role="alert" className="mb-4 text-sm text-[var(--danger)]">{error}<button className="ml-3 underline" onClick={() => void load()}>重新加载</button></p>}
      {loading ? <Spinner /> : sources.length === 0 ? <EmptyState icon={Database} title="还没有连接任何来源" description="添加 NAS 专业资料目录或 Cubox，开始构建你的知识库。" action={<button className="btn btn-accent" onClick={() => edit(null)}>添加第一个来源</button>} /> : <div className="grid gap-4 xl:grid-cols-2">
        {sources.map((source) => {
          const status = sourceStatus(source);
          const running = Boolean(source.activeJob);
          const locked = source.type === "local" && !isAdmin;
          const disabled = busy !== null;
          return <section key={source.id} className="card min-w-0 p-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><span className="chip chip-accent">{sourceTypeLabel(source.type)}</span><span className={`chip ${status.chipClass}`}>{status.label}</span>{!source.enabled && <span className="chip chip-outline">已停用</span>}</div><h2 className="font-semibold">{source.name}</h2></div><Link to={`/library?sourceId=${source.id}`} className="shrink-0 text-sm text-[var(--accent-strong)]">{formatNumber(source.docCount)} 条 →</Link></div>
            <p className="mt-3 break-all text-xs leading-5 text-[var(--muted)]">{sourceLocation(source)}</p>
            <p className="mt-2 text-xs text-[var(--muted-2)]">{syncIntervalLabel(source.syncIntervalMinutes)} · 最近同步 {relativeTime(source.lastSyncAt)}</p>
            {source.lastSyncError && !running && <p role="status" className="mt-3 break-words text-xs text-[var(--danger)]">{source.lastSyncError}</p>}
            {source.activeJob?.stats && <p role="status" className="mt-3 text-xs text-[var(--accent-strong)]">{formatStatsSummary(source.activeJob.stats)}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button disabled={disabled || locked || !source.enabled || running} className="btn btn-accent btn-sm" onClick={() => void act(source, "sync")}><RefreshCw size={13} className={running ? "spin" : ""} />同步</button>
              {running ? <button disabled={disabled || locked} className="btn btn-ghost btn-sm" onClick={() => void act(source, "cancel")}><StopCircle size={13} />取消同步</button> : <button disabled={disabled || locked || !source.enabled} className="btn btn-ghost btn-sm" onClick={() => void act(source, "force")}>全量重同步</button>}
              <button disabled={disabled || locked} className="btn btn-ghost btn-sm" onClick={() => void act(source, "test")}><PlugZap size={13} />测试</button>
              <button disabled={disabled || locked || running} className="btn btn-ghost btn-sm" onClick={() => edit(source)}><Pencil size={13} />编辑</button>
              <button disabled={disabled} className="btn btn-ghost btn-sm" onClick={() => void history(source)}><History size={13} />记录</button>
              <button disabled={disabled || locked || running} className="btn btn-ghost btn-sm" onClick={() => void act(source, "toggle")}>{source.enabled ? "停用" : "启用"}</button>
              <button disabled={disabled || locked || running} className="btn btn-ghost btn-sm" onClick={() => void act(source, "delete")} aria-label={`删除来源 ${source.name}`}><Trash2 size={13} /></button>
            </div>
          </section>;
        })}
      </div>}
      {historySource && <section className="card mt-6 p-5" aria-label="同步历史"><div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg font-semibold">{historySource.name} · 同步记录</h2><button className="btn btn-ghost btn-sm" onClick={() => setHistorySource(null)}>关闭</button></div>{jobsLoading ? <Spinner /> : jobs.length === 0 ? <p className="py-6 text-sm text-[var(--muted)]">暂无同步记录。</p> : <div className="mt-4 space-y-4">{jobs.map((job) => <div key={job.id} className="border-t border-[var(--line)] pt-4 text-xs"><div className="flex flex-wrap items-center gap-3"><span className={`chip ${jobStatusMeta(job.status).chipClass}`}>{jobStatusMeta(job.status).label}</span><span className="text-[var(--muted)]">{formatAbsoluteTime(job.createdAt)}</span></div>{job.stats && <p className="mt-2 leading-5">{formatStatsSummary(job.stats)} · 删除 {job.stats.deleted}{job.stats.note ? ` · ${job.stats.note}` : ""}</p>}{job.error && <p className="mt-2 break-words text-[var(--danger)]">{job.error}</p>}<SyncJobDetails job={job} sourceId={historySource.id} onRetry={() => { toast("已开始重试失败项", "success"); void load(); void history(historySource); }} /></div>)}</div>}</section>}
    </div>
  </div>;
}
