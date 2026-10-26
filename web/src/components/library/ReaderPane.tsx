import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowUpRight, Bot, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download,
  ExternalLink, FileText, Loader2, Maximize2, RefreshCw, X } from "lucide-react";
import { api } from "../../lib/api";
import type { DocumentDetail } from "../../lib/types";
import { externalUrl, documentImageUrl } from "../../lib/library";
import { formatBytes, formatDate, sourceTypeLabel } from "../../lib/format";
import ReaderAssistant from "./ReaderAssistant";

export default function ReaderPane({ id, onClose, onPrevious, onNext, onTag }: {
  id: string | null; onClose: () => void; onPrevious?: () => void; onNext?: () => void; onTag: (tag: string) => void;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [assistant, setAssistant] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [limit, setLimit] = useState(60000);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setDoc(null); setError(""); setAssistant(false); setShowInfo(false); setLimit(60000);
    if (!id) { setLoading(false); return; }
    setLoading(true);
    void api.documents.get(id).then(value => { if (active) { setDoc(value.document); scroll.current?.scrollTo(0, 0); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取文档"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, retry]);
  if (!id) return <section className="reader-pane reader-placeholder"><span className="reader-placeholder-icon"><BookPlaceholder /></span><h2>留一段时间，读点有价值的内容</h2><p>从左侧选择一篇文章或专业文档。<br />在这里阅读、查找原文，也可以让 AI 帮你理解。</p><div><kbd>↑</kbd><kbd>↓</kbd><span>浏览列表</span></div></section>;
  const original = externalUrl(doc?.url);
  const fullContent = doc?.content || "";
  let content = fullContent.slice(0, limit);
  if (doc?.contentFormat === "markdown") {
    const first = content.split("\n")[0].replace(/^#+\s*/, "").trim();
    if (first === doc.title.trim()) content = content.slice(content.indexOf("\n") + 1).trimStart();
  }
  return <section className={"reader-pane " + (assistant ? "with-assistant" : "")} aria-label="文档阅读预览">
    <div className="reader-toolbar">
      <div className="reader-toolbar-nav">
        <button className="reader-back" aria-label="返回文档列表" onClick={onClose}><ArrowLeft size={17} /></button>
        <span className="reader-trail"><span>{doc?.sourceName || "正在打开"}</span><ChevronRight size={12} /><span>阅读</span></span>
      </div>
      <div className="reader-toolbar-actions">
        <button aria-label="上一篇" title="上一篇" disabled={!onPrevious} onClick={onPrevious}><ChevronLeft size={16} /></button>
        <button aria-label="下一篇" title="下一篇" disabled={!onNext} onClick={onNext}><ChevronRight size={16} /></button>
        {doc && <Link to={"/library/" + doc.id} aria-label="独立阅读" title="独立阅读"><Maximize2 size={15} /></Link>}
        <button className={"reader-ai-toggle " + (assistant ? "active" : "")} disabled={!doc} onClick={() => setAssistant(value => !value)} aria-pressed={assistant}><Bot size={16} /><span>问 AI</span></button>
        <button className="reader-close-desktop" aria-label="收起阅读预览" title="收起阅读预览" onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    {loading ? <div className="reader-loading"><Loader2 size={23} className="spin" /><p>正在打开资料…</p></div>
      : error || !doc ? <div className="reader-loading" role="alert"><FileText size={28} /><h3>这篇文档暂时无法打开</h3><p>{error}</p><button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />重新加载</button></div>
      : <div ref={scroll} className="reader-scroll">
        <article className="reading-document">
          <div className="reading-kicker"><span className={"source-dot " + (doc.sourceType === "cubox" ? "violet" : "")} />{sourceTypeLabel(doc.sourceType)}<span>·</span>{doc.mimeType?.includes("pdf") ? "PDF 文档" : doc.kind === "article" ? "文章" : "专业资料"}</div>
          <h1>{doc.title}</h1>
          <div className="reading-meta"><span><CalendarDays size={13} />{formatDate(doc.sourceCreatedAt || doc.publishedAt || doc.createdAt)}</span>
            {doc.author && <span>{doc.author}</span>}
            <span>{doc.size ? formatBytes(doc.size) : fullContent.length.toLocaleString("zh-CN") + " 字符"}</span>
            <button onClick={() => setShowInfo(value => !value)} aria-expanded={showInfo}>详细信息<ChevronDown size={12} /></button>
          </div>
          {showInfo && <dl className="reading-info"><div><dt>来源</dt><dd>{doc.sourceName}</dd></div><div><dt>最近更新</dt><dd>{formatDate(doc.updatedAt, true)}</dd></div><div><dt>正文长度</dt><dd>{fullContent.length.toLocaleString("zh-CN")} 字符</dd></div><div><dt>原始位置</dt><dd>{doc.description || doc.externalId}</dd></div></dl>}
          <div className="reading-actions">
            {original && <a href={original} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />查看原网页<ArrowUpRight size={12} /></a>}
            {doc.fileAvailable && <a href={api.documents.fileUrl(doc.id)} target="_blank" rel="noopener noreferrer"><Download size={13} />打开原文件<ArrowUpRight size={12} /></a>}
            {doc.tags.map(tag => <button key={tag} className="reading-tag" onClick={() => onTag(tag)}>#{tag}</button>)}
          </div>
          {content.trim() ? <div className={"prose-kb reader-content " + (doc.contentFormat === "markdown" ? "" : "reader-plain")}>
            {doc.contentFormat === "markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
              img: ({ src, alt }) => <img src={documentImageUrl(src, doc)} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" />,
            }}>{content}</ReactMarkdown> : content}
          </div> : <div className="reader-no-body"><FileText size={27} /><h3>{doc.kind === "note" ? "这条笔记没有额外正文" : "暂时只有文件信息"}</h3><p>{doc.kind === "note" ? "笔记标题已完整显示在上方。来源没有提供其他可阅读的文本内容。" : doc.metadata?.sizeExceeded ? "文件超过来源的大小上限，尚未提取正文。可以在来源设置中调整上限后重新同步。" : "这个格式尚未提取出可阅读的正文。你可以打开原文件，或到信息来源中重新同步。"}</p><Link to="/sources" className="btn btn-ghost btn-sm">查看来源设置</Link></div>}
          {fullContent.length > limit && <button className="reading-load-more" onClick={() => setLimit(value => value + 60000)}>继续载入正文<span>已显示 {limit.toLocaleString("zh-CN")} / {fullContent.length.toLocaleString("zh-CN")} 字符</span><ChevronDown size={16} /></button>}
          {content.trim() && fullContent.length <= limit && <div className="reading-end"><span />已读至文末<span /></div>}
        </article>
      </div>}
    {assistant && doc && <ReaderAssistant key={doc.id} document={doc} onClose={() => setAssistant(false)} />}
  </section>;
}

function BookPlaceholder() {
  return <svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 12c-4-3-9-4-14-3v23c5-1 10 0 14 3m0-23c4-3 9-4 14-3v23c-5-1-10 0-14 3m0-23v23" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
