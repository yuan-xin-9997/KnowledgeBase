import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Database,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Newspaper,
  NotebookPen,
  Plus,
  RefreshCw,
  Sparkles,
  Tags,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import StatCard from "../components/library/StatCard";
import QuickAsk from "../components/library/QuickAsk";
import SourceDistribution from "../components/library/SourceDistribution";
import { api } from "../lib/api";
import type { Stats } from "../lib/types";
import { formatBytes, formatDate, formatNumber, kindLabel, relativeTime } from "../lib/format";

const KIND_COLORS = ["#b98545", "#2f6f68", "#7d7391", "#a2674f", "#6b7f9e", "#9c8a5a"];

function kindIcon(kind: string): LucideIcon {
  switch (kind) {
    case "article":
      return Newspaper;
    case "note":
      return NotebookPen;
    case "image":
      return ImageIcon;
    default:
      return FileText;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请检查网络连接后重试。";
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="card p-5">
          <div className="flex items-start justify-between">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton h-8 w-8 rounded-lg" />
          </div>
          <div className="skeleton mt-6 h-8 w-24" />
          <div className="skeleton mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Stats | null>(null);
  const [tagNames, setTagNames] = useState<Array<{ tag: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void Promise.all([api.stats(), api.tags.list()])
      .then(([statsResult, tagsResult]) => {
        if (cancelled) return;
        setData(statsResult);
        setTagNames(tagsResult.tags);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const activeSyncs = data?.activeSyncs ?? [];
  const hasActiveSyncs = activeSyncs.length > 0;

  // Keep the sync banner fresh while jobs are running.
  useEffect(() => {
    if (!hasActiveSyncs) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void api
        .stats()
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveSyncs]);

  const sources = data?.bySource ?? [];
  const latestSync = sources.reduce<string | null>((latest, source) => {
    if (!source.last_sync_at) return latest;
    if (!latest || source.last_sync_at > latest) return source.last_sync_at;
    return latest;
  }, null);
  const topTag = tagNames[0];
  const hasSources = (data?.stats.sources ?? 0) > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="你的知识总览"
        description="所有来源在此汇合。继续整理，或直接向知识库提问。"
        actions={
          <>
            <Link to="/chat" className="btn btn-primary btn-sm">
              <Sparkles size={14} aria-hidden />
              开始 AI 会话
            </Link>
            <Link to="/sources" className="btn btn-ghost btn-sm">
              <Plus size={14} aria-hidden />
              添加来源
            </Link>
          </>
        }
      />

      <div className="px-6 py-7 lg:px-10 lg:py-9">
        {!data && loading && <StatsSkeleton />}

        {!data && !loading && error && (
          <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertCircle size={20} aria-hidden />
            </div>
            <h2 className="font-display text-lg font-semibold">暂时无法载入总览</h2>
            <p className="mt-2 max-w-md text-[12.5px] leading-6 text-[var(--muted)]">{error}</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-5"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw size={14} aria-hidden />
              重新加载
            </button>
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="知识条目"
                value={formatNumber(data.stats.documents)}
                hint={`分布于 ${formatNumber(data.stats.sources)} 个来源`}
                icon={FileText}
                tone="accent"
              />
              <StatCard
                label="信息来源"
                value={formatNumber(data.stats.sources)}
                hint={latestSync ? `最近同步 ${relativeTime(latestSync)}` : "还没有同步记录"}
                icon={Database}
                tone="teal"
              />
              <StatCard
                label="标签"
                value={formatNumber(data.stats.tags)}
                hint={topTag ? `最常用「${topTag.tag}」` : "还没有标签"}
                icon={Tags}
                tone="ink"
              />
              <StatCard
                label="占用空间"
                value={formatBytes(data.stats.totalSize)}
                hint={`${formatNumber(data.stats.documents)} 条内容合计`}
                icon={HardDrive}
                tone="clay"
              />
            </div>

            {hasActiveSyncs && (
              <div
                className="mt-5 flex flex-col gap-3 rounded-[var(--radius)] border border-[#e7d2ae] bg-[#fbf3e5] px-4 py-3.5 sm:flex-row sm:items-center"
                role="status"
                aria-live="polite"
              >
                <Loader2
                  size={16}
                  className="spin shrink-0 text-[var(--accent-strong)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-[var(--ink)]">
                    正在同步 {activeSyncs.length} 个来源
                  </p>
                  <p className="mt-0.5 truncate text-[11.5px] text-[var(--muted)]">
                    {activeSyncs
                      .map(
                        (job) =>
                          `${job.source_name}${job.status === "queued" ? "（排队中）" : ""}`,
                      )
                      .join("、")}
                  </p>
                </div>
                <Link to="/sources" className="btn btn-ghost btn-sm shrink-0">
                  查看同步进度
                  <ArrowUpRight size={13} aria-hidden />
                </Link>
              </div>
            )}

            {!hasSources ? (
              <div className="card mt-5">
                <EmptyState
                  icon={Database}
                  title="从一个来源开始"
                  description="接入本地目录、SMB 共享、Cubox 或语雀后，内容会自动汇入知识库，出现在这里。"
                  action={
                    <Link to="/sources" className="btn btn-accent">
                      添加信息来源
                      <ArrowUpRight size={14} aria-hidden />
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-5">
                  <section className="card p-5" aria-labelledby="recent-title">
                    <div className="flex items-center justify-between gap-3">
                      <h2
                        id="recent-title"
                        className="font-display text-[16px] font-semibold text-[var(--ink)]"
                      >
                        最近收录
                      </h2>
                      <Link
                        to="/library"
                        className="inline-flex items-center gap-0.5 text-[11.5px] text-[var(--muted)] transition hover:text-[var(--accent-strong)]"
                      >
                        全部内容
                        <ArrowUpRight size={12} aria-hidden />
                      </Link>
                    </div>

                    {data.recent.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                        <BookOpen
                          size={20}
                          className="text-[var(--accent-strong)]"
                          strokeWidth={1.6}
                          aria-hidden
                        />
                        <p className="text-[12.5px] text-[var(--muted)]">
                          来源已接入，但还没有收录内容。
                        </p>
                        <Link to="/sources" className="btn btn-soft btn-sm">
                          查看来源与同步
                        </Link>
                      </div>
                    ) : (
                      <ul className="mt-2 divide-y divide-[var(--line)]">
                        {data.recent.map((item) => {
                          const Icon = kindIcon(item.kind);
                          return (
                            <li key={item.id}>
                              <Link
                                to={`/library/${item.id}`}
                                className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-[var(--paper)]"
                              >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--paper-2)] text-[var(--muted)] transition group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-strong)]">
                                  <Icon size={14} aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-[var(--ink)] transition group-hover:text-[var(--accent-strong)]">
                                    {item.title}
                                  </span>
                                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--muted-2)]">
                                    <span className="max-w-[45%] truncate">{item.source_name}</span>
                                    <span aria-hidden>·</span>
                                    <span className="shrink-0">
                                      {kindLabel(item.kind)} · {formatDate(item.date)}
                                    </span>
                                  </span>
                                </span>
                                <ChevronRight
                                  size={14}
                                  className="shrink-0 text-[var(--line-strong)] transition group-hover:text-[var(--accent)]"
                                  aria-hidden
                                />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="card p-5" aria-labelledby="kind-title">
                    <div className="flex items-center justify-between gap-3">
                      <h2
                        id="kind-title"
                        className="font-display text-[16px] font-semibold text-[var(--ink)]"
                      >
                        按类型
                      </h2>
                      <span className="text-[11.5px] text-[var(--muted-2)]">
                        {data.byKind.length} 种类型
                      </span>
                    </div>
                    {data.byKind.length === 0 ? (
                      <p className="py-6 text-center text-[12.5px] text-[var(--muted)]">
                        还没有可分类的内容。
                      </p>
                    ) : (
                      <>
                        <div
                          className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-[var(--paper-2)]"
                          role="img"
                          aria-label={data.byKind
                            .map((kind) => `${kindLabel(kind.kind)} ${kind.count} 条`)
                            .join("，")}
                        >
                          {data.byKind.map((kind, index) => (
                            <div
                              key={kind.kind}
                              className="h-full first:rounded-l-full last:rounded-r-full"
                              style={{
                                width: `${(kind.count / Math.max(1, data.stats.documents)) * 100}%`,
                                backgroundColor: KIND_COLORS[index % KIND_COLORS.length],
                              }}
                            />
                          ))}
                        </div>
                        <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-3">
                          {data.byKind.map((kind, index) => (
                            <li
                              key={kind.kind}
                              className="flex items-center justify-between gap-2 text-[12px]"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-sm"
                                  style={{
                                    backgroundColor: KIND_COLORS[index % KIND_COLORS.length],
                                  }}
                                  aria-hidden
                                />
                                <span className="truncate text-[var(--ink)]">
                                  {kindLabel(kind.kind)}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-[var(--muted)]">
                                {formatNumber(kind.count)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                </div>

                <div className="flex min-w-0 flex-col gap-5">
                  <QuickAsk />
                  <SourceDistribution bySource={sources} total={data.stats.documents} />
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 text-[11.5px] text-[var(--danger)]" role="alert">
                刷新数据失败：{error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
