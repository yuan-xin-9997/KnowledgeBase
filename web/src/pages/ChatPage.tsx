import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Cpu,
  Loader2,
  Menu,
  PanelRight,
  X,
} from "lucide-react";
import ChatSessionList from "../components/chat/ChatSessionList";
import ChatMessageList, {
  type ChatStreamState,
  type ChatUiMessage,
} from "../components/chat/ChatMessageList";
import ChatComposer, { CHAT_INPUT_LIMIT } from "../components/chat/ChatComposer";
import ChatScopePanel from "../components/chat/ChatScopePanel";
import type { DocumentMeta } from "../components/chat/DocumentPicker";
import { useToast } from "../components/Toast";
import { api, streamChat } from "../lib/api";
import type { ChatScope, ChatSession, Provider, Source } from "../lib/types";

const EMPTY_SCOPE: ChatScope = { mode: "all", sourceIds: [], documentIds: [] };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export default function ChatPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const docParam = searchParams.get("doc");
  const qParam = searchParams.get("q");

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [docMeta, setDocMeta] = useState<Record<string, DocumentMeta>>({});
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<"none" | "sessions" | "scope">("none");
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<ChatStreamState | null>(null);
  const [creating, setCreating] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<ChatScope>(EMPTY_SCOPE);
  const [draftProviderId, setDraftProviderId] = useState<string | null>(null);

  const streamRef = useRef<ChatStreamState | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const bootstrapKeyRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  const focusRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const docMetaRef = useRef<Record<string, DocumentMeta>>({});
  const pendingMetaRef = useRef<Set<string>>(new Set());
  const providersRef = useRef<Provider[]>([]);

  const updateStream = useCallback((next: ChatStreamState | null) => {
    streamRef.current = next;
    setStream(next);
  }, []);

  const refreshSessions = useCallback(async (syncId?: string | null) => {
    try {
      const result = await api.chat.sessions();
      const sorted = sortSessions(result.sessions);
      setSessions(sorted);
      if (syncId) {
        const found = sorted.find((item) => item.id === syncId);
        if (found) {
          setSession((prev) => (prev && prev.id === syncId ? { ...prev, ...found } : prev));
        }
      }
    } catch {
      // Listing failures should not interrupt an active conversation.
    }
  }, []);

  const stopStream = useCallback(() => {
    const current = streamRef.current;
    abortRef.current?.();
    abortRef.current = null;
    if (current?.content.trim()) {
      setMessages((prev) => [
        ...prev,
        {
          id: current.messageId ?? `local-stop-${Date.now()}`,
          role: "assistant",
          content: current.content,
          citations: current.citations,
          createdAt: new Date().toISOString(),
          stopped: true,
        },
      ]);
    }
    updateStream(null);
    if (current) void refreshSessions(current.sessionId);
  }, [updateStream, refreshSessions]);

  const ensureDocMeta = useCallback((ids: string[]) => {
    for (const documentId of ids) {
      if (docMetaRef.current[documentId] || pendingMetaRef.current.has(documentId)) continue;
      pendingMetaRef.current.add(documentId);
      api.documents
        .get(documentId)
        .then((result) => {
          setDocMeta((prev) => {
            const next = {
              ...prev,
              [documentId]: {
                id: documentId,
                title: result.document.title,
                sourceName: result.document.sourceName,
              },
            };
            docMetaRef.current = next;
            return next;
          });
        })
        .catch(() => {
          setDocMeta((prev) => {
            const next = {
              ...prev,
              [documentId]: { id: documentId, title: "（文档不可用）", sourceName: "" },
            };
            docMetaRef.current = next;
            return next;
          });
        })
        .finally(() => {
          pendingMetaRef.current.delete(documentId);
        });
    }
  }, []);

  // Initial reference data.
  useEffect(() => {
    let alive = true;
    void refreshSessions().finally(() => {
      if (alive) setSessionsLoading(false);
    });
    api.providers
      .list()
      .then((result) => {
        if (!alive) return;
        providersRef.current = result.providers;
        setProviders(result.providers);
        setDraftProviderId((prev) => prev ?? result.providers[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (alive) toast(errorMessage(error, "载入模型配置失败"), "error");
      })
      .finally(() => {
        if (alive) setProvidersLoading(false);
      });
    api.sources
      .list()
      .then((result) => {
        if (alive) setSources(result.sources);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setSourcesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshSessions, toast]);

  // Load an existing conversation.
  useEffect(() => {
    if (!id) {
      abortRef.current?.();
      abortRef.current = null;
      updateStream(null);
      setSession(null);
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    if (skipLoadRef.current === id) {
      skipLoadRef.current = null;
      return;
    }
    abortRef.current?.();
    abortRef.current = null;
    updateStream(null);
    let alive = true;
    setMessagesLoading(true);
    setBannerError(null);
    setSession(null);
    api.chat
      .get(id)
      .then((result) => {
        if (!alive) return;
        setSession(result.session);
        setMessages(result.messages);
        setDraftScope(result.session.scope);
        ensureDocMeta(result.session.scope.documentIds);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setBannerError(errorMessage(error, "会话载入失败"));
      })
      .finally(() => {
        if (alive) setMessagesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, updateStream, ensureDocMeta]);

  // Allow a deep link to run again after navigating back to a plain /chat.
  useEffect(() => {
    if (!docParam && !qParam) bootstrapKeyRef.current = null;
  }, [docParam, qParam]);

  // `?doc=` / `?q=` deep links: create a session exactly once per link.
  useEffect(() => {
    if (id || providersLoading) return;
    const key = docParam ? `doc:${docParam}` : qParam ? `q:${qParam}` : null;
    if (!key || bootstrapKeyRef.current === key) return;
    bootstrapKeyRef.current = key;

    const scope: ChatScope = docParam
      ? { mode: "documents", sourceIds: [], documentIds: [docParam] }
      : { ...EMPTY_SCOPE };

    if (docParam) ensureDocMeta([docParam]);
    setBootstrapping(true);
    setBannerError(null);

    api.chat
      .create({
        scope,
        providerId: providersRef.current[0]?.id ?? null,
      })
      .then((result) => {
        setSession(result.session);
        setMessages([]);
        setDraftScope(result.session.scope);
        setDraftProviderId(result.session.providerId ?? providersRef.current[0]?.id ?? null);
        setInput(qParam ?? "");
        if (qParam) focusRef.current = true;
        void refreshSessions();
        skipLoadRef.current = result.session.id;
        navigate(`/chat/${result.session.id}`, { replace: true });
      })
      .catch((error: unknown) => {
        bootstrapKeyRef.current = null;
        setBannerError(errorMessage(error, "创建会话失败"));
        toast(errorMessage(error, "创建会话失败"), "error");
      })
      .finally(() => {
        setBootstrapping(false);
      });
  }, [
    id,
    docParam,
    qParam,
    providersLoading,
    ensureDocMeta,
    navigate,
    refreshSessions,
    toast,
  ]);

  // Abort any in-flight stream when leaving the page.
  useEffect(
    () => () => {
      abortRef.current?.();
      abortRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!focusRef.current || !session?.id) return;
    focusRef.current = false;
    const handle = window.setTimeout(() => composerRef.current?.focus(), 80);
    return () => window.clearTimeout(handle);
  }, [session?.id]);

  useEffect(() => {
    if (mobilePanel === "none") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobilePanel("none");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobilePanel]);

  const activeScope = session?.scope ?? draftScope;
  const activeProviderId = session ? session.providerId : draftProviderId;
  const currentProvider = providers.find((provider) => provider.id === activeProviderId) ?? null;
  const noProvider = !providersLoading && providers.length === 0;

  const scopeDocuments = useMemo(() => {
    return activeScope.documentIds.map(
      (documentId) =>
        docMeta[documentId] ?? { id: documentId, title: "正在载入…", sourceName: "" },
    );
  }, [activeScope.documentIds, docMeta]);

  const scopeSummary = useMemo(() => {
    const scope = activeScope;
    if (scope.mode === "all") return "全部知识库";
    if (scope.mode === "none") return "不使用知识库";
    if (scope.mode === "sources") {
      const names = scope.sourceIds
        .map((sourceId) => sources.find((source) => source.id === sourceId)?.name)
        .filter((name): name is string => Boolean(name));
      if (!names.length) return "指定来源 · 未选择";
      const preview = names.slice(0, 2).join("、");
      return `指定来源 · ${preview}${names.length > 2 ? ` 等 ${names.length} 个` : ""}`;
    }
    const titles = scope.documentIds
      .map((documentId) => docMeta[documentId]?.title)
      .filter((title): title is string => Boolean(title));
    if (!titles.length) return `指定文档 · ${scope.documentIds.length} 篇`;
    return `指定文档 · ${titles[0]}${titles.length > 1 ? ` 等 ${titles.length} 篇` : ""}`;
  }, [activeScope, sources, docMeta]);

  const handleSaveScope = async (next: ChatScope) => {
    if (!session) {
      setDraftScope(next);
      toast("知识范围已保存，将在发送时生效", "success");
      return;
    }
    setScopeSaving(true);
    try {
      const result = await api.chat.update(session.id, { scope: next });
      setSession(result.session);
      setDraftScope(result.session.scope);
      ensureDocMeta(next.documentIds);
      toast("知识范围已更新", "success");
    } catch (error) {
      toast(errorMessage(error, "保存知识范围失败"), "error");
    } finally {
      setScopeSaving(false);
    }
  };

  const handleNewSession = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const result = await api.chat.create({
        scope: { ...EMPTY_SCOPE },
        providerId: session?.providerId ?? draftProviderId ?? providersRef.current[0]?.id ?? null,
      });
      setInput("");
      setBannerError(null);
      setSession(result.session);
      setMessages([]);
      setDraftScope(result.session.scope);
      setDraftProviderId(result.session.providerId ?? providersRef.current[0]?.id ?? null);
      skipLoadRef.current = result.session.id;
      setMobilePanel("none");
      navigate(`/chat/${result.session.id}`);
      void refreshSessions();
    } catch (error) {
      toast(errorMessage(error, "创建会话失败"), "error");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const handleRename = async (sessionId: string, title: string) => {
    try {
      const result = await api.chat.update(sessionId, { title });
      setSessions((prev) =>
        sortSessions(prev.map((item) => (item.id === sessionId ? result.session : item))),
      );
      setSession((prev) => (prev && prev.id === sessionId ? { ...prev, title: result.session.title } : prev));
    } catch (error) {
      toast(errorMessage(error, "重命名失败"), "error");
    }
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await api.chat.remove(sessionId);
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      if (session?.id === sessionId) {
        abortRef.current?.();
        abortRef.current = null;
        updateStream(null);
        setSession(null);
        setMessages([]);
        setInput("");
        navigate("/chat", { replace: true });
      }
      toast("会话已删除", "success");
    } catch (error) {
      toast(errorMessage(error, "删除会话失败"), "error");
    }
  };

  const handleProviderChange = async (value: string) => {
    const nextId = value || null;
    if (!session) {
      setDraftProviderId(nextId);
      return;
    }
    const previous = session.providerId;
    const targetId = session.id;
    setSession({ ...session, providerId: nextId });
    try {
      const result = await api.chat.update(targetId, { providerId: nextId });
      setSession((prev) => (prev && prev.id === targetId ? result.session : prev));
      setDraftProviderId(result.session.providerId);
      toast("已切换模型", "success");
    } catch (error) {
      setSession((prev) =>
        prev && prev.id === targetId ? { ...prev, providerId: previous } : prev,
      );
      toast(errorMessage(error, "切换模型失败"), "error");
    }
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || streamRef.current !== null) return;
    if (content.length > CHAT_INPUT_LIMIT) return;
    if (providers.length === 0) {
      toast("请先在设置中配置模型", "error");
      return;
    }

    let target = session;
    if (!target) {
      try {
        const result = await api.chat.create({
          scope: draftScope,
          providerId: draftProviderId ?? providersRef.current[0]?.id ?? null,
        });
        target = result.session;
        setSession(result.session);
        setDraftScope(result.session.scope);
        setDraftProviderId(result.session.providerId ?? draftProviderId);
        skipLoadRef.current = result.session.id;
        navigate(`/chat/${result.session.id}`, { replace: true });
        void refreshSessions();
      } catch (error) {
        toast(errorMessage(error, "创建会话失败"), "error");
        return;
      }
    }

    const sessionId = target.id;
    const optimisticId = `local-user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: "user",
        content,
        citations: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput("");
    setBannerError(null);
    updateStream({ content: "", citations: null, sessionId });

    const abort = streamChat(sessionId, content, (event) => {
      switch (event.type) {
        case "start": {
          if (event.userMessage) {
            const userMessage = event.userMessage;
            setMessages((prev) =>
              prev.map((message) => (message.id === optimisticId ? userMessage : message)),
            );
          }
          if (event.messageId) {
            const current = streamRef.current;
            if (current) updateStream({ ...current, messageId: event.messageId });
          }
          break;
        }
        case "delta": {
          const current = streamRef.current;
          if (current) updateStream({ ...current, content: current.content + event.text });
          break;
        }
        case "citations": {
          const current = streamRef.current;
          if (current) updateStream({ ...current, citations: event.citations });
          break;
        }
        case "done": {
          const finalMessage = event.message;
          setMessages((prev) => {
            const exists = prev.some((message) => message.id === finalMessage.id);
            return exists
              ? prev.map((message) => (message.id === finalMessage.id ? finalMessage : message))
              : [...prev, finalMessage];
          });
          updateStream(null);
          abortRef.current = null;
          void refreshSessions(sessionId);
          break;
        }
        case "error": {
          const message = event.error || "生成回复失败";
          setBannerError(message);
          toast(message, "error");
          const current = streamRef.current;
          if (current?.content.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                id: current.messageId ?? `local-error-${Date.now()}`,
                role: "assistant",
                content: current.content,
                citations: current.citations,
                createdAt: new Date().toISOString(),
                stopped: true,
              },
            ]);
          }
          updateStream(null);
          abortRef.current = null;
          void refreshSessions(sessionId);
          break;
        }
      }
    });
    abortRef.current = abort;
  };

  const handlePickPrompt = (prompt: string) => {
    setInput(prompt);
    composerRef.current?.focus();
  };

  const toggleScope = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      setScopeOpen((open) => !open);
    } else {
      setMobilePanel("scope");
    }
  };

  const sessionList = (
    <ChatSessionList
      sessions={sessions}
      activeId={session?.id ?? id ?? null}
      loading={sessionsLoading}
      creating={creating}
      onSelect={(sessionId) => {
        setMobilePanel("none");
        navigate(`/chat/${sessionId}`);
      }}
      onNew={() => void handleNewSession()}
      onRename={handleRename}
      onDelete={handleDelete}
      onClose={() => setMobilePanel("none")}
      className="w-full border-r border-[var(--line)] lg:w-[250px]"
    />
  );

  const scopePanel = (
    <ChatScopePanel
      scope={activeScope}
      sources={sources}
      documents={scopeDocuments}
      sourcesLoading={sourcesLoading}
      saving={scopeSaving}
      onSave={handleSaveScope}
      onClose={() => {
        if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
          setScopeOpen(false);
        }
        setMobilePanel("none");
      }}
    />
  );

  const showEmptyLoader = (messagesLoading || bootstrapping) && !session;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[var(--paper)] lg:h-screen">
      <div className="flex min-h-0 flex-1">
        <aside className="hidden shrink-0 lg:block">{sessionList}</aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-[var(--card)]/55 px-3 py-2.5 sm:px-4 lg:px-5">
            <button
              onClick={() => setMobilePanel("sessions")}
              className="btn btn-ghost btn-icon lg:hidden"
              title="会话列表"
              aria-label="会话列表"
            >
              <Menu size={16} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-[16px] font-semibold lg:text-[17px]">
                  {session?.title || (bootstrapping ? "正在创建会话…" : "新会话")}
                </h1>
                {stream && (
                  <span className="chip chip-accent shrink-0">
                    <Loader2 size={10} className="spin" /> 生成中
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--muted-2)]">
                <span className="flex min-w-0 items-center gap-1">
                  <Cpu size={11} className="shrink-0" />
                  <span className="truncate">
                    {currentProvider
                      ? `${currentProvider.name} · ${currentProvider.model}`
                      : providersLoading
                        ? "载入模型…"
                        : "未配置模型"}
                  </span>
                </span>
                <span className="shrink-0">·</span>
                <span className="min-w-0 truncate">{scopeSummary}</span>
              </div>
            </div>

            <div className="relative shrink-0">
              <select
                value={activeProviderId ?? ""}
                onChange={(event) => void handleProviderChange(event.target.value)}
                disabled={providersLoading || providers.length === 0}
                title="选择模型"
                className="select h-8 w-[142px] py-0 pl-2.5 pr-7 text-[11.5px] sm:w-[172px]"
              >
                {providers.length === 0 && <option value="">未配置模型</option>}
                {providers.length > 0 && !activeProviderId && <option value="">未选择模型</option>}
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.model}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={toggleScope}
              className="btn btn-ghost btn-sm shrink-0"
              title="设置知识范围"
            >
              <PanelRight size={14} />
              <span className="hidden sm:inline">设置范围</span>
            </button>
          </header>

          {bannerError && (
            <div className="flex items-start gap-2 border-b border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--danger)] sm:px-4 lg:px-5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{bannerError}</span>
              <button
                onClick={() => setBannerError(null)}
                className="shrink-0 rounded p-0.5 hover:bg-white/40"
                aria-label="关闭提示"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {session?.scope.mode === "none" && (
            <div className="border-b border-[var(--line)] bg-[var(--paper-2)]/60 px-4 py-1.5 text-[11px] text-[var(--muted)]">
              当前未使用知识库，回答不会包含引用来源。
            </div>
          )}

          <ChatMessageList
            conversationId={session?.id ?? null}
            messages={messages}
            stream={stream}
            loading={showEmptyLoader}
            onPickPrompt={handlePickPrompt}
          />

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={() => void handleSend()}
            onStop={stopStream}
            streaming={stream !== null}
            disabled={creating}
            noProvider={noProvider}
            textareaRef={composerRef}
          />
        </section>

        {scopeOpen && (
          <aside className="hidden w-[300px] shrink-0 border-l border-[var(--line)] lg:block">
            {scopePanel}
          </aside>
        )}
      </div>

      {mobilePanel !== "none" && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobilePanel("none")}
          />
          <div
            className={`absolute inset-y-0 w-[300px] max-w-[86vw] bg-[var(--card)] shadow-[var(--shadow-md)] ${
              mobilePanel === "sessions" ? "left-0" : "right-0"
            }`}
          >
            {mobilePanel === "sessions" ? sessionList : scopePanel}
          </div>
        </div>
      )}

      {noProvider && (
        <div className="border-t border-[var(--line)] bg-[var(--paper-2)] px-4 py-1.5 text-center text-[11px] text-[var(--muted)] lg:hidden">
          <Link to="/settings" className="text-[var(--accent-strong)] underline">
            配置模型
          </Link>{" "}
          后即可开始对话
        </div>
      )}
    </div>
  );
}
