import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowDownWideNarrow, BookOpen, BookmarkPlus, ChevronLeft, ChevronRight,
  FileText, FolderOpen, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import Highlight from "../components/library/Highlight";
import ReaderPane from "../components/library/ReaderPane";
import { api } from "../lib/api";
import { cleanExcerpt, loadSavedViews, savedQuery, storeSavedViews } from "../lib/library";
import type { SearchResponse, Source } from "../lib/types";
import { formatDate, formatNumber, kindLabel } from "../lib/format";

const PAGE_SIZE = 30;
export default function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const q = params.get("q") || "";
  const rawMode = params.get("mode");
  const mode = rawMode === "title" || rawMode === "content" || rawMode === "attachment" ? rawMode : "all";
  const sourceId = params.get("sourceId") || "";
  const kind = params.get("kind") || "";
  const tag = params.get("tag") || "";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const sort = params.get("sort") === "oldest" ? "oldest" : params.get("sort") === "newest" ? "newest" : q ? "relevance" : "newest";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1)));
  const selectedId = params.get("doc");
  const [input, setInput] = useState(q);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [reload, setReload] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listScroll = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const loadedKey = useRef("");
  const queryKey = JSON.stringify([q, mode, sourceId, kind, tag, from, to, sort, page, reload]);
  const items = result?.items || [];
  const total = result?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentIndex = items.findIndex(item => item.id === selectedId);
  const activeFilters = [sourceId, kind, tag, from, to].filter(Boolean).length;
  const heading = q ? "搜索结果" : sourceId ? sources.find(source => source.id === sourceId)?.name || "来源文档"
    : tag ? "#" + tag : kind === "article" ? "文章" : kind === "file" ? "专业文件" : from ? "最近添加" : "全部文档";

  useEffect(() => { setInput(q); }, [q]);
  useEffect(() => {
    let active = true;
    void api.sources.list().then(value => { if (active) setSources(value.sources); }).catch(() => undefined);
    void api.tags.list().then(value => { if (active) setTags(value.tags); }).catch(() => undefined);
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true); setError("");
    const shared = { mode, sourceId: sourceId || undefined, kind: kind || undefined, tag: tag || undefined,
      from: from || undefined, to: to || undefined, sort, page, pageSize: PAGE_SIZE };
    const promise = q ? api.search.query({ ...shared, q }) : api.documents.list(shared);
    void promise.then(value => {
      if (id !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(value.total / PAGE_SIZE));
      if (page > lastPage) {
        setParams(previous => { const next = new URLSearchParams(previous); next.set("page", String(lastPage)); next.delete("doc"); return next; }, { replace: true });
      }
      loadedKey.current = queryKey;
      setResult(value); listScroll.current?.scrollTo(0, 0);
    }).catch(reason => {
      if (id === requestId.current) { setError(reason instanceof Error ? reason.message : "加载失败，请重试"); setResult(null); }
    }).finally(() => { if (id === requestId.current) setLoading(false); });
    return () => { requestId.current++; };
  }, [q, mode, sourceId, kind, tag, from, to, sort, page, reload, queryKey, setParams]);
  useEffect(() => { setDismissed(false); }, [q, mode, sourceId, kind, tag, from, to, page]);
  useEffect(() => {
    if (!loading && loadedKey.current === queryKey && !selectedId && !dismissed && items.length && window.matchMedia("(min-width: 900px)").matches) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set("doc", items[0].id); return next; }, { replace: true });
    }
  }, [loading, selectedId, dismissed, items, queryKey, setParams]);
  useEffect(() => {
    document.getElementById("library-row-" + selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const patch = useCallback((changes: Record<string, string | null>) => {
    setDismissed(false);
    setParams(previous => {
      const next = new URLSearchParams(previous); next.delete("page"); next.delete("doc");
      for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
      return next;
    });
  }, [setParams]);
  const selectDocument = (id: string) => {
    setDismissed(false);
    setParams(previous => { const next = new URLSearchParams(previous); next.set("doc", id); return next; });
  };
  const goToPage = (value: number) => {
    setDismissed(false);
    setParams(previous => { const next = new URLSearchParams(previous); next.set("page", String(value)); next.delete("doc"); return next; });
  };
  const reset = () => { setInput(""); setDismissed(false); setParams({}); };
  return <div className={"library-workspace " + (selectedId ? "has-selection" : "")}>
    <section className={"library-list-column " + (!selectedId || dismissed ? "wide-list" : "")} aria-label="文档列表" onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable || !items.length || loading) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? Math.min(items.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
        selectDocument(items[next].id);
      }
    }}>
      <header className="library-list-header">
        <div className="library-heading"><div><span className="library-eyebrow">我的知识空间</span><h1>{heading}</h1></div>
          <div><button className="icon-button" aria-label="保存当前筛选" title="保存筛选到此浏览器" onClick={() => { setViewName(q || heading); setSaveOpen(value => !value); }}><BookmarkPlus size={17} /></button>
          <button className="icon-button" aria-label="刷新文档" title="刷新文档" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} className={loading ? "spin" : ""} /></button></div>
        </div>
        <form className="library-search" onSubmit={event => { event.preventDefault(); patch({ q: input.trim() || null }); }}>
          <Search size={17} /><input id="library-search" aria-label="搜索文档" placeholder="搜索标题、正文或附件…" value={input} onChange={event => setInput(event.target.value)} />
          {input && <button type="button" aria-label="清空搜索" onClick={() => { setInput(""); patch({ q: null }); }}><X size={14} /></button>}
          <button type="submit" className="library-search-submit" aria-label="执行搜索"><ChevronRight size={17} /></button>
        </form>
        <div className="library-quick-controls">
          <select aria-label="搜索范围" value={mode} onChange={event => patch({ mode: event.target.value === "all" ? null : event.target.value })}>
            <option value="all">全部内容</option><option value="title">仅标题</option><option value="content">正文</option><option value="attachment">附件</option>
          </select>
          <button className={filtersOpen || activeFilters ? "active" : ""} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={13} />筛选{activeFilters > 0 && <b>{activeFilters}</b>}</button>
          {(q || activeFilters || mode !== "all") && <button className="library-reset" onClick={reset}>重置</button>}
        </div>
        {filtersOpen && <div className="library-filter-panel">
          <label>来源<select value={sourceId} onChange={event => patch({ sourceId: event.target.value || null })}><option value="">全部来源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
          <label>类型<select value={kind} onChange={event => patch({ kind: event.target.value || null })}><option value="">全部类型</option><option value="article">文章</option><option value="file">文件</option><option value="note">笔记</option></select></label>
          <label className="filter-full">标签<select value={tag} onChange={event => patch({ tag: event.target.value || null })}><option value="">全部标签</option>{tags.map(item => <option key={item.tag} value={item.tag}>{item.tag}</option>)}</select></label>
          <label>开始日期<input aria-label="开始日期" type="date" value={from} onChange={event => patch({ from: event.target.value || null })} /></label>
          <label>结束日期<input aria-label="结束日期" type="date" value={to} min={from || undefined} onChange={event => patch({ to: event.target.value || null })} /></label>
        </div>}
        {saveOpen && <form className="save-view-form" onSubmit={event => {
          event.preventDefault();
          if (!user || !viewName.trim()) return;
          try {
            const views = loadSavedViews(user.id);
            const query = savedQuery(params);
            const remaining = views.filter(view => view.query !== query);
            storeSavedViews(user.id, [{ id: Date.now().toString(36), name: viewName.trim().slice(0, 40), query }, ...remaining]);
            setSaveOpen(false); toast("筛选已保存到左侧导航", "success");
          } catch { toast("浏览器暂时无法保存筛选", "error"); }
        }}><input aria-label="筛选名称" placeholder="为这个筛选起个名字" value={viewName} maxLength={40} onChange={event => setViewName(event.target.value)} /><button className="btn btn-primary btn-sm" disabled={!viewName.trim()}>保存</button><button type="button" className="icon-button" aria-label="取消保存筛选" onClick={() => setSaveOpen(false)}><X size={14} /></button></form>}
        <div className="library-list-meta"><span>{loading ? "正在查找…" : formatNumber(total) + " 篇资料"}{q && <strong> · “{q}”</strong>}</span>
          <label><ArrowDownWideNarrow size={12} /><select aria-label="排序方式" value={sort} onChange={event => patch({ sort: event.target.value })}>
            {q && <option value="relevance">相关度</option>}<option value="newest">最新优先</option><option value="oldest">最早优先</option>
          </select></label>
        </div>
      </header>
      <div className="library-items" ref={listScroll} role="listbox" aria-label="知识库文档" aria-busy={loading} tabIndex={0}>
        {loading ? <div className="library-list-skeleton">{[1,2,3,4,5,6].map(value => <div key={value}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>)}</div>
          : error ? <div className="library-empty" role="alert"><AlertCircle size={26} /><h2>资料暂时没能加载</h2><p>{error}</p><button className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)}>重新加载</button></div>
          : !items.length ? <div className="library-empty"><FolderOpen size={29} /><h2>{q || activeFilters ? "没有匹配的资料" : "把你的知识连接到这里"}</h2><p>{q || activeFilters ? "试试更短的关键词，或调整筛选条件。" : "接入 Cubox、NAS 或语雀，文章与文档就会出现在这里。"}</p>{q || activeFilters ? <button className="btn btn-ghost btn-sm" onClick={reset}>清除筛选</button> : <Link to="/sources" className="btn btn-primary btn-sm">添加信息来源</Link>}</div>
          : items.map(item => {
            const excerpt = cleanExcerpt(item.snippet, item.title);
            const isPdf = item.mimeType?.includes("pdf");
            const selected = selectedId === item.id;
            return <button type="button" role="option" aria-selected={selected} id={"library-row-" + item.id} key={item.id}
              className={"library-row " + (selected ? "selected" : "")} onClick={() => selectDocument(item.id)}>
              <div className="library-row-top"><span className={"document-type-icon " + (item.kind === "article" ? "article" : "")}>{item.kind === "article" ? <BookOpen size={15} /> : <FileText size={15} />}</span>
                <span className="library-row-type">{isPdf ? "PDF" : kindLabel(item.kind)}</span><time>{formatDate(item.sourceCreatedAt || item.publishedAt || item.updatedAt)}</time></div>
              <h2><Highlight text={item.title} terms={result?.terms || []} /></h2>
              <p>{excerpt ? <Highlight text={excerpt} terms={result?.terms || []} /> : <span className="library-metadata-only">{item.kind === "file" ? "文件信息 · 暂无正文摘要" : "打开查看这条资料"}</span>}</p>
              <div className="library-row-bottom"><span><i className={"source-dot " + (item.kind === "article" ? "violet" : "")} />{item.sourceName}</span>{item.tags[0] && <span className="row-tag">#{item.tags[0]}</span>}{selected && <span className="reading-indicator">阅读中</span>}</div>
            </button>;
          })}
      </div>
      <footer className="library-list-footer"><span>{totalPages > 1 ? page + " / " + totalPages + " 页" : "↑ ↓ 切换文档"}</span><span>{items.length > 0 && (page - 1) * PAGE_SIZE + 1} {items.length > 0 && "— " + Math.min(page * PAGE_SIZE, total)}</span>
        <div><button aria-label="上一页" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}><ChevronLeft size={15} /></button><button aria-label="下一页" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}><ChevronRight size={15} /></button></div>
      </footer>
    </section>
    <ReaderPane id={selectedId} onClose={() => {
      setDismissed(true); setParams(previous => { const next = new URLSearchParams(previous); next.delete("doc"); return next; }, { replace: true });
    }} onPrevious={currentIndex > 0 ? () => selectDocument(items[currentIndex - 1].id) : undefined}
      onNext={currentIndex >= 0 && currentIndex < items.length - 1 ? () => selectDocument(items[currentIndex + 1].id) : undefined}
      onTag={value => patch({ tag: value })} />
  </div>;
}
