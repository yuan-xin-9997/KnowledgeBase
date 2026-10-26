import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { SyncItem, SyncJob } from "../../lib/types";
const labels: Record<string, string> = { created: "新增", updated: "更新", skipped: "跳过", deleted: "移出索引", error: "失败" };
export default function SyncJobDetails({ job, sourceId, onRetry }: { job: SyncJob; sourceId: string; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<SyncItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (open) { setBusy(true); setError(""); void api.jobs.items(job.id, offset, action || undefined).then(value => { if (active) { setItems(value.items); setTotal(value.total); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "明细加载失败"); }).finally(() => { if (active) setBusy(false); }); }
    return () => { active = false; };
  }, [job.id, open, offset, action, retry]);
  return <div className="sync-details"><button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起明细" : "查看项目明细"}</button>
    {!!job.stats?.errors && !["running", "queued"].includes(job.status) && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={async () => {
      setBusy(true); setError(""); try { await api.sources.sync(sourceId, false, job.id); onRetry(); } catch (reason) { setError(reason instanceof Error ? reason.message : "重试失败"); } finally { setBusy(false); }
    }}>仅重试失败项</button>}
    {error && <p role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>重新加载</button></p>}
    {open && <div><label>项目状态 <select value={action} onChange={event => { setAction(event.target.value); setOffset(0); }}><option value="">全部</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {busy ? <p role="status">加载中…</p> : items.length ? <ul>{items.map(item => <li key={item.externalId}><strong>{labels[item.action]}</strong> · {item.title}<small>{item.externalId}</small>{item.error && <p role="alert">{item.error}</p>}</li>)}</ul> : <p>暂无项目明细；旧任务可在下次同步后查看。</p>}
      <div><button disabled={!offset || busy} onClick={() => setOffset(value => Math.max(0, value - 50))}>上一页</button><span> 共 {total} 项 </span><button disabled={offset + 50 >= total || busy} onClick={() => setOffset(value => value + 50)}>下一页</button></div>
    </div>}
  </div>;
}
