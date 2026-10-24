import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { Stats } from "../../lib/types";
import { formatNumber, relativeTime } from "../../lib/format";

type SourceStat = Stats["bySource"][number];

function statusDot(source: SourceStat): string {
  if (source.last_sync_status === "error") return "bg-[var(--danger)]";
  if (source.last_sync_status === "running") return "bg-[var(--accent)] animate-pulse";
  if (source.last_sync_status === "success") return "bg-[var(--success)]";
  return "bg-[var(--line-strong)]";
}

function syncHint(source: SourceStat): string {
  if (source.last_sync_status === "running") return "正在同步…";
  if (source.last_sync_status === "error") {
    return `上次同步失败 · ${relativeTime(source.last_sync_at)}`;
  }
  if (!source.last_sync_at) return "尚未同步";
  return `上次同步 ${relativeTime(source.last_sync_at)}`;
}

export default function SourceDistribution({
  bySource,
  total,
}: {
  bySource: SourceStat[];
  total: number;
}) {
  const max = bySource.reduce((peak, source) => Math.max(peak, source.doc_count), 0);
  const sorted = [...bySource].sort((a, b) => b.doc_count - a.doc_count);

  return (
    <section className="card flex flex-col p-5" aria-labelledby="source-dist-title">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="source-dist-title"
          className="font-display text-[16px] font-semibold text-[var(--ink)]"
        >
          来源分布
        </h2>
        <Link
          to="/sources"
          className="inline-flex items-center gap-0.5 text-[11.5px] text-[var(--muted)] transition hover:text-[var(--accent-strong)]"
        >
          管理来源
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <p className="text-[12.5px] text-[var(--muted)]">还没有接入任何来源。</p>
          <Link to="/sources" className="btn btn-soft btn-sm mt-4">
            添加第一个来源
          </Link>
        </div>
      ) : (
        <ul className="mt-4 flex max-h-[330px] flex-col gap-3.5 overflow-auto pr-1">
          {sorted.map((source) => {
            const percent = total > 0 ? Math.round((source.doc_count / total) * 100) : 0;
            const width =
              max > 0 ? Math.max(source.doc_count > 0 ? 2 : 0, (source.doc_count / max) * 100) : 0;
            const failed = source.last_sync_status === "error";
            return (
              <li key={source.id}>
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(source)}`}
                      aria-hidden
                    />
                    <Link
                      to={`/library?sourceId=${encodeURIComponent(source.id)}`}
                      className="truncate text-[var(--ink)] transition hover:text-[var(--accent-strong)]"
                      title={source.name}
                    >
                      {source.name}
                    </Link>
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--muted)]">
                    {formatNumber(source.doc_count)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-3.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--paper-2)]">
                    <div
                      className={`h-full rounded-full ${failed ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--muted-2)]">
                    {percent}%
                  </span>
                </div>
                <div
                  className={`mt-1 pl-3.5 text-[10.5px] ${failed ? "text-[var(--danger)]" : "text-[var(--muted-2)]"}`}
                >
                  {syncHint(source)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
