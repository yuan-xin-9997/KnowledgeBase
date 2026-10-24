import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import DocumentCard from "../components/library/DocumentCard";
import Pagination from "../components/library/Pagination";
import { api } from "../lib/api";
import type { SearchResponse } from "../lib/types";
import { formatNumber, kindLabel } from "../lib/format";

const PAGE_SIZE = 20;

type Sort = "relevance" | "newest" | "oldest";

const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: "relevance", label: "相关度" },
  { value: "newest", label: "最新" },
  { value: "oldest", label: "最早" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请检查网络连接后重试。";
}

export default function LibraryPage() {
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const rawMode = params.get("mode");
  const mode = rawMode === "title" || rawMode === "content" || rawMode === "attachment" ? rawMode : "all";
  const sourceId = params.get("sourceId") ?? "";
  const kind = params.get("kind") ?? "";
  const tag = params.get("tag") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const rawSort = params.get("sort");
  const sort: Sort =
    rawSort === "oldest" ? "oldest" : rawSort === "newest" ? "newest" : q ? "relevance" : "newest";
  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const [input, setInput] = useState(q);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() =>
    ["sourceId", "kind", "tag", "from", "to"].some((key) => params.has(key)),
  );

  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [kinds, setKinds] = useState<Array<{ kind: string; count: number }>>([]);

  useEffect(() => {
    setInput(q);
  }, [q]);

  // Filter options are loaded once; failures only degrade the dropdowns.
  useEffect(() => {
    let alive = true;
    void Promise.allSettled([api.sources.list(), api.tags.list(), api.stats()]).then(
      ([sourceResult, tagResult, statsResult]) => {
        if (!alive) return;
        if (sourceResult.status === "fulfilled") {
          setSources(sourceResult.value.sources.map((source) => ({ id: source.id, name: source.name })));
        }
        if (tagResult.status === "fulfilled") setTags(tagResult.value.tags);
        if (statsResult.status === "fulfilled") setKinds(statsResult.value.byKind);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);

    const shared = {
      mode,
      sourceId: sourceId || undefined,
      kind: kind || undefined,
      tag: tag || undefined,
      // `to` is inclusive for the whole day.
      from: from || undefined,
      to: to || undefined,
      sort,
      page,
      pageSize: PAGE_SIZE,
    };

    const request = q
      ? api.search.query({ ...shared, q, mode })
      : api.documents.list(shared);

    request
      .then((response) => {
        if (requestId !== requestRef.current) return;
        setResult(response);
        const lastPage = Math.max(1, Math.ceil(response.total / Math.max(1, response.pageSize)));
        if (page > lastPage) {
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              if (lastPage > 1) next.set("page", String(lastPage));
              else next.delete("page");
              return next;
            },
            { replace: true },
          );
        }
      })
      .catch((reason: unknown) => {
        if (requestId !== requestRef.current) return;
        setError(errorMessage(reason));
      })
      .finally(() => {
        if (requestId === requestRef.current) setLoading(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [q, mode, sourceId, kind, tag, from, to, sort, page, reloadKey, setParams]);

  const patch = useCallback(
    (changes: Record<string, string | null>, options?: { resetPage?: boolean }) => {
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        if (options?.resetPage !== false) next.delete("page");
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      });
    },
    [setParams],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    patch(value ? { q: value } : { q: null });
  };

  const clearQuery = () => {
    setInput("");
    patch({ q: null });
  };

  const resetAll = () => {
    setInput("");
    patch({
      q: null,
      mode: null,
      sourceId: null,
      kind: null,
      tag: null,
      from: null,
      to: null,
      sort: null,
      page: null,
    });
  };

  const goToPage = (next: number) => {
    patch({ page: next > 1 ? String(next) : null }, { resetPage: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const activeFilterCount = [sourceId, kind, tag, from, to].filter(Boolean).length;
  const hasQuery = q.length > 0 || activeFilterCount > 0;
  const terms = result?.terms ?? [];
  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="知识库"
        description="检索标题、正文与附件，或按来源、类型与时间缩小范围。"
        actions={
          <Link to="/sources" className="btn btn-ghost btn-sm">
            管理来源
          </Link>
        }
      />

      <div className="px-6 py-7 lg:px-10 lg:py-9">
        <section className="card p-4 sm:p-5" aria-label="搜索与筛选">
          <form onSubmit={submit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <label htmlFor="library-search" className="sr-only">
                搜索知识库
              </label>
              <Search
                size={17}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
                aria-hidden
              />
              <input
                id="library-search"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="搜索标题、正文、标签…"
                autoComplete="off"
                className="input h-12 pl-10 pr-10 text-[15px]"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {loading && (
                  <Loader2
                    size={15}
                    className="spin text-[var(--muted-2)]"
                    aria-label="正在检索"
                  />
                )}
                {input.length > 0 && (
                  <button
                    type="button"
                    onClick={clearQuery}
                    aria-label="清除搜索词"
                    className="rounded-md p-1.5 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="搜索模式"
                className="inline-flex shrink-0 rounded-lg border border-[var(--line-strong)] bg-[var(--paper-2)] p-0.5"
              >
                {(
                  [
                    { value: "all", label: "全部" },
                    { value: "title", label: "仅标题" },
                    { value: "content", label: "正文" },
                    { value: "attachment", label: "附件" },
                  ] as const
                ).map((option) => {
                  const active = mode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => patch({ mode: option.value === "all" ? null : option.value })}
                      className={`rounded-[7px] px-3 py-1.5 text-[12px] transition ${
                        active
                          ? "bg-[var(--card)] text-[var(--ink)] shadow-[var(--shadow-sm)]"
                          : "text-[var(--muted)] hover:text-[var(--ink)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <button type="submit" className="btn btn-primary h-12 px-5">
                搜索
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm lg:hidden"
              aria-expanded={filtersOpen}
              aria-controls="library-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal size={14} aria-hidden />
              筛选
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-[var(--accent-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--accent-strong)]">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown
                size={13}
                className={filtersOpen ? "rotate-180 transition" : "transition"}
                aria-hidden
              />
            </button>
            <p className="flex-1 text-[11px] leading-5 text-[var(--muted-2)]">
              {input.trim() !== q
                ? "按 Enter 应用新的关键词"
                : "按 Enter 搜索 · 筛选条件会同步到地址栏，可刷新或分享"}
            </p>
            {hasQuery && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
                <RefreshCw size={13} aria-hidden />
                重置全部
              </button>
            )}
          </div>

          <div
            id="library-filters"
            className={`${filtersOpen ? "grid" : "hidden"} mt-3 gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-3 xl:grid-cols-6`}
          >
            <div className="field">
              <label className="label" htmlFor="filter-source">
                来源
              </label>
              <select
                id="filter-source"
                className="select"
                value={sourceId}
                onChange={(event) => patch({ sourceId: event.target.value || null })}
              >
                <option value="">全部来源</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="filter-kind">
                类型
              </label>
              <select
                id="filter-kind"
                className="select"
                value={kind}
                onChange={(event) => patch({ kind: event.target.value || null })}
              >
                <option value="">全部类型</option>
                {kinds.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {kindLabel(item.kind)}（{item.count}）
                  </option>
                ))}
                {kind && !kinds.some((item) => item.kind === kind) && (
                  <option value={kind}>{kindLabel(kind)}</option>
                )}
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="filter-tag">
                标签
              </label>
              <select
                id="filter-tag"
                className="select"
                value={tag}
                onChange={(event) => patch({ tag: event.target.value || null })}
              >
                <option value="">全部标签</option>
                {tags.map((item) => (
                  <option key={item.tag} value={item.tag}>
                    {item.tag}（{item.count}）
                  </option>
                ))}
                {tag && !tags.some((item) => item.tag === tag) && <option value={tag}>{tag}</option>}
              </select>
            </div>

            <div className="field sm:col-span-2 xl:col-span-2">
              <span className="label" id="filter-range-label">
                时间范围
              </span>
              <div className="flex items-center gap-2" role="group" aria-labelledby="filter-range-label">
                <input
                  type="date"
                  aria-label="起始日期"
                  className="input min-w-0 px-2.5 py-2 text-[12.5px]"
                  value={from}
                  onChange={(event) => patch({ from: event.target.value || null })}
                />
                <span className="shrink-0 text-[var(--muted-2)]" aria-hidden>
                  –
                </span>
                <input
                  type="date"
                  aria-label="结束日期"
                  className="input min-w-0 px-2.5 py-2 text-[12.5px]"
                  value={to}
                  onChange={(event) => patch({ to: event.target.value || null })}
                />
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="filter-sort">
                排序
              </label>
              <select
                id="filter-sort"
                className="select"
                value={sort}
                onChange={(event) => patch({ sort: event.target.value })}
              >
                {SORT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === "relevance" && !q}
                  >
                    {option.label}
                    {option.value === "relevance" && !q ? "（需关键词）" : ""}
                  </option>
                ))}
              </select>
            </div>

          </div>
        </section>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[17px] font-semibold text-[var(--ink)]">
              {q ? "搜索结果" : "全部内容"}
            </h2>
            <span className="text-[12px] text-[var(--muted)]" aria-live="polite">
              {loading && !result ? "正在载入…" : `共 ${formatNumber(total)} 条`}
            </span>
          </div>
          {q && (
            <span className="max-w-[60%] truncate text-[11.5px] text-[var(--muted-2)]">
              关键词「{q}」
              {mode === "title" ? " · 仅标题" : mode === "content" ? " · 正文" : mode === "attachment" ? " · 附件" : ""}
            </span>
          )}
        </div>

        {error && result && (
          <div
            className="mt-3 flex items-center gap-2 rounded-lg border border-[#eccfc9] bg-[var(--danger-soft)] px-3 py-2 text-[11.5px] text-[var(--danger)]"
            role="alert"
          >
            <AlertCircle size={13} aria-hidden />
            <span className="min-w-0 flex-1">刷新失败，显示的是上一次结果。</span>
            <button
              type="button"
              className="shrink-0 underline underline-offset-2"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              重试
            </button>
          </div>
        )}

        {error && !result ? (
          <div className="card mt-4 flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertCircle size={20} aria-hidden />
            </div>
            <h3 className="font-display text-lg font-semibold">检索失败</h3>
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
        ) : loading && !result ? (
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="card p-5">
                <div className="skeleton h-4 w-2/5" />
                <div className="skeleton mt-3 h-3 w-full" />
                <div className="skeleton mt-2 h-3 w-4/5" />
                <div className="skeleton mt-4 h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card mt-4">
            <EmptyState
              icon={hasQuery ? Search : BookOpen}
              title={hasQuery ? "没有匹配的内容" : "知识库还是空的"}
              description={
                hasQuery
                  ? "换个关键词，或减少来源、类型与时间范围等筛选条件再试一次。"
                  : "添加信息来源并完成一次同步后，收录的内容会出现在这里。"
              }
              action={
                hasQuery ? (
                  <button type="button" className="btn btn-ghost" onClick={resetAll}>
                    清除搜索与筛选
                  </button>
                ) : (
                  <Link to="/sources" className="btn btn-accent">
                    添加信息来源
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <div
            className={`mt-4 flex flex-col gap-3 transition-opacity ${
              loading ? "opacity-60" : "opacity-100"
            }`}
            aria-busy={loading}
          >
            {items.map((item) => (
              <DocumentCard key={item.id} item={item} terms={terms} />
            ))}
          </div>
        )}

        {result && items.length > 0 && (
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            onChange={goToPage}
          />
        )}
      </div>
    </div>
  );
}
