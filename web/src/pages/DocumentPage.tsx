import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileQuestion,
  Info,
  Link2,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import Spinner from "../components/Spinner";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { ApiError, api } from "../lib/api";
import type { DocumentDetail } from "../lib/types";
import {
  formatBytes,
  formatDate,
  kindLabel,
  sourceTypeLabel,
} from "../lib/format";

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--muted-2)]">{label}</dt>
      <dd className="break-words text-[12.5px] leading-5 text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [metaOpen, setMetaOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setDoc(null);
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setDoc(null);

    api.documents
      .get(id)
      .then(({ document }) => {
        if (cancelled) return;
        setDoc(document);
        window.scrollTo({ top: 0 });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 404) setNotFound(true);
        else setError(reason instanceof Error ? reason.message : "请稍后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label}已复制`, "success");
    } catch {
      toast("复制失败，请手动选择后复制", "error");
    }
  };

  if (loading) {
    return <Spinner label="正在打开文档…" />;
  }

  if (notFound) {
    return (
      <div className="px-6 py-10 lg:px-10">
        <div className="card mx-auto max-w-3xl">
          <EmptyState
            icon={FileQuestion}
            title="文档不存在或已被移除"
            description="这条内容可能已从来源中删除，或尚未完成同步。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link to="/library" className="btn btn-ghost">
                  返回知识库
                </Link>
                <Link to="/sources" className="btn btn-accent">
                  查看信息来源
                </Link>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="px-6 py-10 lg:px-10">
        <div className="card mx-auto flex max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
            <AlertCircle size={20} aria-hidden />
          </div>
          <h1 className="font-display text-lg font-semibold">无法打开这篇文档</h1>
          <p className="mt-2 max-w-md text-[12.5px] leading-6 text-[var(--muted)]">
            {error ?? "文档内容暂时不可用。"}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw size={14} aria-hidden />
              重新加载
            </button>
            <Link to="/library" className="btn btn-soft btn-sm">
              返回知识库
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isMarkdown = doc.contentFormat.toLowerCase() === "markdown";
  const originalUrl = httpUrl(doc.url);
  const displayDate = doc.sourceCreatedAt || doc.publishedAt || doc.createdAt;
  const hasContent = Boolean(doc.content && doc.content.trim());

  return (
    <div className="px-6 py-7 lg:px-10 lg:py-9">
      <div className="mx-auto max-w-[1120px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/library"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            <ArrowLeft size={14} aria-hidden />
            返回知识库
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void copyText(window.location.href, "文档链接")}
            >
              <Link2 size={13} aria-hidden />
              复制链接
            </button>
            {doc.fileAvailable && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  window.open(api.documents.fileUrl(doc.id), "_blank", "noopener,noreferrer")
                }
              >
                <Download size={13} aria-hidden />
                打开原文件
              </button>
            )}
            {originalUrl && (
              <a
                href={originalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-ghost btn-sm"
              >
                <ExternalLink size={13} aria-hidden />
                原文
              </a>
            )}
            <Link to={`/chat?doc=${encodeURIComponent(doc.id)}`} className="btn btn-accent btn-sm">
              <Sparkles size={13} aria-hidden />
              就此文档提问
            </Link>
          </div>
        </div>

        <header className="mt-6 border-b border-[var(--line)] pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/library?sourceId=${encodeURIComponent(doc.sourceId)}`}
              className="chip chip-accent transition hover:brightness-95"
            >
              {doc.sourceName}
            </Link>
            <span className="chip chip-outline">{kindLabel(doc.kind)}</span>
            {doc.tags.map((tag) => (
              <Link
                key={tag}
                to={`/library?tag=${encodeURIComponent(tag)}`}
                className="chip chip-outline transition hover:border-[var(--muted-2)] hover:text-[var(--ink)]"
              >
                #{tag}
              </Link>
            ))}
          </div>

          <h1 className="mt-3.5 font-display text-[27px] font-semibold leading-[1.3] tracking-tight text-[var(--ink)] lg:text-[32px]">
            {doc.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--muted-2)]">
            {doc.author && (
              <span className="inline-flex max-w-full items-center gap-1.5">
                <UserRound size={12} aria-hidden />
                <span className="truncate">{doc.author}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={12} aria-hidden />
              {formatDate(displayDate, true)}
            </span>
            {doc.size ? <span>{formatBytes(doc.size)}</span> : null}
            {doc.fileAvailable && (
              <span className="inline-flex items-center gap-1.5 text-[var(--success)]">
                <CheckCircle2 size={12} aria-hidden />
                原文件可用
              </span>
            )}
          </div>
        </header>

        <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_286px] lg:gap-7">
          <article className="card order-2 px-5 py-7 sm:px-9 sm:py-10 lg:order-1">
            <div className="mx-auto max-w-[720px]">
              {doc.description && (
                <p className="mb-7 border-l-2 border-[var(--accent)] pl-4 text-[13.5px] leading-7 text-[var(--muted)]">
                  {doc.description}
                </p>
              )}

              {hasContent ? (
                isMarkdown ? (
                  <div className="prose-kb">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noreferrer noopener">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {doc.content ?? ""}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.85] text-[#2b2a26]">
                    {doc.content}
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-[13px] text-[var(--muted)]">这篇文档没有可读正文。</p>
                  {doc.fileAvailable && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-4"
                      onClick={() =>
                        window.open(
                          api.documents.fileUrl(doc.id),
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <Download size={14} aria-hidden />
                      打开原文件
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>

          <aside className="card order-1 h-fit lg:order-2 lg:sticky lg:top-6">
            <div className="hidden items-center gap-2 px-5 py-4 lg:flex">
              <span className="flex items-center gap-2 font-display text-[14px] font-semibold text-[var(--ink)]">
                <Info size={14} className="text-[var(--accent-strong)]" aria-hidden />
                文档信息
              </span>
            </div>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left lg:hidden"
              onClick={() => setMetaOpen((open) => !open)}
              aria-expanded={metaOpen}
              aria-controls="document-meta"
            >
              <span className="flex items-center gap-2 font-display text-[14px] font-semibold text-[var(--ink)]">
                <Info size={14} className="text-[var(--accent-strong)]" aria-hidden />
                文档信息
              </span>
              <ChevronDown
                size={15}
                className={`text-[var(--muted-2)] transition ${metaOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>

            <div
              id="document-meta"
              className={`${metaOpen ? "block" : "hidden"} border-t border-[var(--line)] px-5 py-4 lg:block`}
            >
              <dl className="flex flex-col gap-3.5">
                <MetaRow label="来源">
                  <Link
                    to={`/library?sourceId=${encodeURIComponent(doc.sourceId)}`}
                    className="text-[var(--accent-strong)] hover:underline"
                  >
                    {doc.sourceName}
                  </Link>
                  <span className="ml-1.5 text-[11px] text-[var(--muted-2)]">
                    {sourceTypeLabel(doc.sourceType)}
                  </span>
                </MetaRow>
                <MetaRow label="类型">{kindLabel(doc.kind)}</MetaRow>
                <MetaRow label="外部 ID">
                  <span className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1 break-all font-mono text-[11.5px] text-[var(--muted)]">
                      {doc.externalId}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
                      aria-label="复制外部 ID"
                      onClick={() => void copyText(doc.externalId, "外部 ID")}
                    >
                      <Copy size={12} aria-hidden />
                    </button>
                  </span>
                </MetaRow>
                <MetaRow label="收录时间">{formatDate(doc.createdAt, true)}</MetaRow>
                <MetaRow label="最近更新">{formatDate(doc.updatedAt, true)}</MetaRow>
                {doc.publishedAt && (
                  <MetaRow label="发布时间">{formatDate(doc.publishedAt, true)}</MetaRow>
                )}
                {doc.size ? <MetaRow label="文件大小">{formatBytes(doc.size)}</MetaRow> : null}
                {doc.mimeType && <MetaRow label="文件类型">{doc.mimeType}</MetaRow>}
                {doc.language && <MetaRow label="语言">{doc.language}</MetaRow>}
                <MetaRow label="内容格式">
                  {isMarkdown ? "Markdown" : "纯文本"}
                </MetaRow>
              </dl>

              {doc.tags.length > 0 && (
                <div className="mt-4 border-t border-[var(--line)] pt-3.5">
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--muted-2)]">
                    标签
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {doc.tags.map((tag) => (
                      <Link
                        key={tag}
                        to={`/library?tag=${encodeURIComponent(tag)}`}
                        className="chip transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                      >
                        {tag}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
