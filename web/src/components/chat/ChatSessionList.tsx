import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import type { ChatSession } from "../../lib/types";
import { relativeTime } from "../../lib/format";

export default function ChatSessionList({
  sessions,
  activeId,
  loading,
  creating,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
  className = "",
}: {
  sessions: ChatSession[];
  activeId: string | null;
  loading?: boolean;
  creating?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onClose?: () => void;
  className?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setDraftTitle(session.title || "");
    setConfirmId(null);
  };

  const commitRename = async (session: ChatSession) => {
    if (editingId !== session.id) return;
    const next = draftTitle.trim();
    setEditingId(null);
    if (!next || next === session.title) return;
    setBusyId(session.id);
    try {
      await onRename(session.id, next);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await onDelete(id);
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={`flex h-full flex-col bg-[var(--card)] ${className}`}>
      <div className="flex items-center justify-between gap-2 px-3.5 pb-3 pt-4">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-2)]">
          会话
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            disabled={creating}
            className="btn btn-soft btn-sm"
            title="新建会话"
          >
            {creating ? <Loader2 size={13} className="spin" /> : <MessageSquarePlus size={13} />}
            新建
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)] lg:hidden"
              aria-label="关闭会话列表"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-[var(--muted-2)]">
            <Loader2 size={13} className="spin" /> 载入会话…
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-3 py-6 text-[12.5px] leading-6 text-[var(--muted-2)]">
            还没有会话。点击「新建」开始第一次提问。
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((session) => {
              const active = session.id === activeId;
              const busy = busyId === session.id;
              return (
                <div
                  key={session.id}
                  className={`group relative rounded-xl border px-2.5 py-2.5 transition ${
                    active
                      ? "border-[var(--line-strong)] bg-[var(--paper)] shadow-[var(--shadow-sm)]"
                      : "border-transparent hover:bg-[var(--paper-2)]"
                  }`}
                >
                  {editingId === session.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        ref={inputRef}
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitRename(session);
                          } else if (event.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        onBlur={() => void commitRename(session)}
                        maxLength={120}
                        className="input h-8 flex-1 px-2 py-1 text-[12.5px]"
                        placeholder="会话标题"
                      />
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void commitRename(session)}
                        className="rounded p-1 text-[var(--success)] hover:bg-[var(--paper-2)]"
                        title="保存"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setEditingId(null)}
                        className="rounded p-1 text-[var(--muted)] hover:bg-[var(--paper-2)]"
                        title="取消"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => onSelect(session.id)}
                        disabled={busy}
                        className="block w-full pr-10 text-left"
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ink)]">
                            {session.title || "未命名会话"}
                          </span>
                          <span className="shrink-0 text-[10px] text-[var(--muted-2)]">
                            {relativeTime(session.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-[1.55] text-[var(--muted-2)]">
                          {session.lastMessage ||
                            (session.messageCount ? `${session.messageCount} 条消息` : "暂无消息")}
                        </p>
                      </button>
                      <div className="absolute right-1.5 top-2 hidden items-center gap-0.5 rounded-lg bg-[var(--card)]/90 pl-1 group-hover:flex group-focus-within:flex">
                        {busy ? (
                          <Loader2 size={12} className="spin text-[var(--muted-2)]" />
                        ) : (
                          <>
                            <button
                              onClick={() => startRename(session)}
                              className="rounded p-1 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
                              title="重命名"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => setConfirmId(session.id)}
                              className="rounded p-1 text-[var(--muted-2)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                              title="删除"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {confirmId === session.id && (
                    <div className="mt-2 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-2.5 py-2">
                      <p className="text-[11.5px] leading-5 text-[var(--danger)]">
                        删除「{session.title || "未命名会话"}」？此操作不可撤销。
                      </p>
                      <div className="mt-1.5 flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setConfirmId(null)}
                          className="btn btn-ghost btn-sm"
                        >
                          取消
                        </button>
                        <button
                          onClick={() => void remove(session.id)}
                          disabled={busy}
                          className="btn btn-danger btn-sm"
                        >
                          {busy ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
