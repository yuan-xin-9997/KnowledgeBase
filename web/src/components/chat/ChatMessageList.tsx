import { citationLink } from "../../lib/library";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { Plugin } from "unified";
import {
  ArrowDown,
  Bot,
  ExternalLink,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { ChatMessage, Citation } from "../../lib/types";
import { formatDate } from "../../lib/format";

export interface ChatUiMessage extends ChatMessage {
  stopped?: boolean;
}

export interface ChatStreamState {
  content: string;
  citations: Citation[] | null;
  messageId?: string;
  sessionId: string;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

function splitCitationText(value: string, map: Map<number, string>): MdNode[] | null {
  const regex = /\[(\d{1,3})\]/g;
  const nodes: MdNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = regex.exec(value);
  while (match) {
    const documentId = map.get(Number(match[1]));
    if (documentId) {
      if (match.index > cursor) {
        nodes.push({ type: "text", value: value.slice(cursor, match.index) });
      }
      nodes.push({
        type: "link",
        url: documentId,
        children: [{ type: "text", value: match[0] }],
      });
      cursor = match.index + match[0].length;
    }
    match = regex.exec(value);
  }
  if (!nodes.length) return null;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

/** Turns `[1]` references into in-app links pointing at the cited document. */
function createCitationPlugin(citations: Citation[]): Plugin {
  const map = new Map(citations.map((citation) => [citation.index, citationLink(citation)]));

  const walk = (node: MdNode): void => {
    if (!node.children) return;
    const next: MdNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        const pieces = splitCitationText(child.value, map);
        if (pieces) {
          next.push(...pieces);
          continue;
        }
      }
      if (
        child.type !== "link" &&
        child.type !== "inlineCode" &&
        child.type !== "code" &&
        child.type !== "html"
      ) {
        walk(child);
      }
      next.push(child);
    }
    node.children = next;
  };

  return () => (tree) => {
    walk(tree as unknown as MdNode);
  };
}

const markdownComponents: Components = {
  a({ href, children }) {
    if (href && (href.startsWith("/library/") || href.startsWith("/library?"))) {
      return (
        <Link
          to={href}
          style={{ textDecoration: "none" }}
          className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--accent-soft)] px-1 align-middle text-[10.5px] font-semibold leading-none text-[var(--accent-strong)] transition hover:bg-[var(--accent)] hover:text-white"
        >
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

const EMPTY_CITATIONS: Citation[] = [];

function CitationCards({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">
        引用来源
      </div>
      {citations.map((citation) => (
        <div
          key={`${citation.index}-${citation.documentId}`}
          className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2 transition hover:border-[var(--line-strong)]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-strong)]">
            {citation.index}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              to={citationLink(citation)}
              className="block truncate text-[12.5px] font-medium leading-5 hover:text-[var(--accent-strong)]"
            >
              {citation.title}
            </Link>
            <div className="truncate text-[11px] text-[var(--muted-2)]">{citation.sourceName}</div>
          </div>
          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              title="打开原文"
              className="shrink-0 rounded-md p-1.5 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function AssistantBody({
  content,
  citations,
  streaming,
}: {
  content: string;
  citations: Citation[] | null;
  streaming?: boolean;
}) {
  const list = citations ?? EMPTY_CITATIONS;
  const plugin = useMemo(() => createCitationPlugin(list), [list]);
  const hasContent = content.trim().length > 0;

  return (
    <div className="min-w-0 flex-1">
      {hasContent ? (
        <div className="prose-kb">
          <ReactMarkdown remarkPlugins={[plugin, remarkGfm]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-[var(--accent)]" />
          )}
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-1.5 py-1 text-[var(--muted-2)]">
          <span className="flex gap-1">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            ))}
          </span>
          <span className="ml-1 text-[12.5px]">正在思考…</span>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--muted)]">（没有内容）</p>
      )}
      <CitationCards citations={list} />
    </div>
  );
}

const SAMPLE_QUESTIONS = [
  "帮我总结最近收藏的内容",
  "我关于 AI 的笔记里有哪些关键观点？",
  "把某个主题的资料整理成知识脉络",
  "最近有哪些值得重读的文章？",
];

export default function ChatMessageList({
  conversationId,
  messages,
  stream,
  loading,
  onPickPrompt,
}: {
  conversationId: string | null;
  messages: ChatUiMessage[];
  stream: ChatStreamState | null;
  loading?: boolean;
  onPickPrompt: (prompt: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distance < 100;
    stickRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
    const frame = window.requestAnimationFrame(() => scrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [conversationId]);

  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, stream?.content, stream?.citations]);

  const empty = messages.length === 0 && !stream;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {loading && empty ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-[13px] text-[var(--muted)]">
              <Loader2 size={18} className="spin" />
              正在打开会话…
            </div>
          ) : empty ? (
            <div className="fade-up flex flex-col items-center px-2 py-14 text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
                <Sparkles size={22} className="text-[var(--accent-strong)]" strokeWidth={1.6} />
              </div>
              <h2 className="font-display text-[21px] font-semibold">问点什么？</h2>
              <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--muted)]">
                我会在右侧选定的知识范围内检索，并附上可点击的引用来源。
              </p>
              <div className="mt-7 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {SAMPLE_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    onClick={() => onPickPrompt(question)}
                    className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-left text-[12.5px] leading-5 text-[var(--muted)] transition hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:text-[var(--ink)] hover:shadow-[var(--shadow-sm)]"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              if (isUser) {
                return (
                  <div key={message.id} className="fade-up flex justify-end gap-2.5">
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl rounded-tr-sm border border-[var(--line)] bg-[var(--accent-soft)] px-4 py-2.5 text-[14px] leading-6 whitespace-pre-wrap text-[var(--ink)]">
                        {message.content}
                      </div>
                      <div className="mt-1 text-right text-[10.5px] text-[var(--muted-2)]">
                        {formatDate(message.createdAt, true)}
                      </div>
                    </div>
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--paper-2)] text-[var(--muted)]">
                      <UserRound size={14} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.id} className="fade-up flex gap-2.5">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[#f0e5cf]">
                    <Bot size={14} />
                  </div>
                  <AssistantBody
                    content={message.content}
                    citations={message.citations}
                    streaming={false}
                  />
                  {message.stopped && (
                    <span className="mt-1 shrink-0 text-[10.5px] text-[var(--muted-2)]">
                      已停止
                    </span>
                  )}
                </div>
              );
            })
          )}

          {stream && (
            <div className="fade-up flex gap-2.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[#f0e5cf]">
                <Bot size={14} />
              </div>
              <AssistantBody content={stream.content} citations={stream.citations} streaming />
            </div>
          )}
        </div>
      </div>

      {showJump && !empty && (
        <button
          onClick={() => {
            stickRef.current = true;
            setShowJump(false);
            scrollToBottom("smooth");
          }}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-3 py-1.5 text-[11.5px] text-[var(--muted)] shadow-[var(--shadow-md)] transition hover:text-[var(--ink)]"
        >
          <ArrowDown size={12} /> 回到底部
        </button>
      )}
    </div>
  );
}
