import { citationLink } from "../../lib/library";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Bot, ExternalLink, Loader2, Square, X } from "lucide-react";
import { api, streamChat } from "../../lib/api";
import type { ChatMessage, ChatScope, DocumentDetail, Provider } from "../../lib/types";

export default function ReaderAssistant({ document, onClose, folder = "" }: { document: DocumentDetail; folder?: string; onClose: () => void }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("document");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const abort = useRef<(() => void) | null>(null);
  const requestNumber = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    void api.providers.list().then(value => {
      if (alive.current) { setProviders(value.providers); setProviderId(value.providers[0]?.id || ""); }
    }).catch(reason => { if (alive.current) setError(reason instanceof Error ? reason.message : "模型配置加载失败"); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; abort.current?.(); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);
  const reset = () => { requestNumber.current++; setSessionId(null); setMessages([]); setError(""); setStopped(false); };
  const send = async (value: string) => {
    const text = value.trim();
    if (!text || !providerId || busy) return;
    const currentRequest = ++requestNumber.current;
    setBusy(true); setStopped(false); setError(""); setInput("");
    const localId = "local-" + Date.now();
    const userMessage: ChatMessage = { id: localId, role: "user", content: text, citations: [], createdAt: new Date().toISOString() };
    const botId = localId + "-assistant";
    setMessages(previous => [...previous, userMessage, { ...userMessage, id: botId, role: "assistant", content: "" }]);
    try {
      let id = sessionId;
      if (!id) {
        const chatScope: ChatScope = {
          mode: scope === "document" ? "documents" : (scope === "source" || scope === "folder") ? "sources" : scope === "all" ? "all" : "none",
          sourceIds: (scope === "source" || scope === "folder") ? [document.sourceId] : [],
          documentIds: scope === "document" ? [document.id] : [],
          ...(scope === "folder" ? { folder } : {}),
        };
        const created = await api.chat.create({ title: document.title.slice(0, 60), providerId, scope: chatScope });
        if (!alive.current || currentRequest !== requestNumber.current) return;
        id = created.session.id; setSessionId(id);
      }
      abort.current = streamChat(id, text, event => {
        if (!alive.current || currentRequest !== requestNumber.current) return;
        if (event.type === "delta") setMessages(previous => previous.map(message => message.id === botId ? { ...message, content: message.content + event.text } : message));
        if (event.type === "citations") setMessages(previous => previous.map(message => message.id === botId ? { ...message, citations: event.citations } : message));
        if (event.type === "done") {
          setMessages(previous => previous.map(message => message.id === botId ? event.message : message));
          setBusy(false); abort.current = null;
        }
        if (event.type === "error") { setError(event.error); setBusy(false); abort.current = null; }
      });
    } catch (reason) {
      if (alive.current && currentRequest === requestNumber.current) { setError(reason instanceof Error ? reason.message : "提问失败，请重试"); setBusy(false); }
    }
  };
  return <aside className="reader-assistant" aria-label="阅读 AI 助手">
    <header><span><Bot size={17} />阅读助手</span><button aria-label="关闭阅读助手" onClick={onClose}><X size={17} /></button></header>
    <div className="assistant-context">
      <label>知识范围<select aria-label="助手知识范围" disabled={busy} value={scope} onChange={event => { setScope(event.target.value); reset(); }}>
        <option value="document">当前文档</option><option value="source">当前来源</option>{folder && <option value="folder">当前文件夹（含子目录）</option>}<option value="all">全部知识库</option><option value="none">不使用知识库</option>
      </select></label>
      <p title={scope === "source" ? document.sourceName : document.title}>{scope === "folder" ? folder : scope === "document" ? document.title : scope === "source" ? document.sourceName : scope === "all" ? "检索你已连接的所有来源" : "仅使用模型的通用知识"}</p>
      {providers.length > 0 && <select aria-label="助手模型" disabled={busy} value={providerId} onChange={event => { setProviderId(event.target.value); reset(); }}>
        {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
      </select>}
    </div>
    <div className="assistant-scroll" aria-live="polite">
      {loading ? <div className="assistant-welcome"><Loader2 className="spin" size={20} /><p>正在加载模型配置…</p></div>
        : !providers.length ? <div className="assistant-welcome"><Bot size={28} /><h3>让资料回答你的问题</h3><p>{error || "先在设置中连接一个模型，就能对当前文档提问。你的资料会按选定范围提供给模型。"}</p><Link className="btn btn-primary btn-sm" to="/settings">配置 AI 模型</Link></div>
        : messages.length === 0 ? <div className="assistant-welcome"><span className="assistant-orb"><Bot size={25} /></span><h3>读得更深一点</h3><p>提炼重点，解释概念，或带着问题重新读一遍。</p>
          {["概括这篇资料的核心观点", "提取关键概念并解释", "这篇资料有哪些值得进一步思考的问题？"].map(question => <button key={question} onClick={() => void send(question)}>{question}<ArrowUp size={13} /></button>)}
          {!document.content && <p className="assistant-note">当前文档暂无正文，模型可能无法获得足够的参考内容。</p>}
        </div> : messages.map(message => <div key={message.id} className={"assistant-message " + message.role}>
          <span className="assistant-role">{message.role === "user" ? "你" : "阅读助手"}</span>
          {message.content ? <div className="prose-kb"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
            : busy ? <span className="assistant-thinking"><Loader2 size={13} className="spin" />正在阅读资料…</span> : <span className="assistant-note">{stopped ? "已停止生成" : "未生成内容"}</span>}
          {message.role === "assistant" && (message.citations?.length || 0) > 0 && <div className="assistant-citations">{(message.citations || []).map(citation => <Link key={citation.index} to={citationLink(citation)} title={citation.title}>[{citation.index}] {citation.title}</Link>)}</div>}
        </div>)}
      {error && providers.length > 0 && <p className="assistant-error" role="alert">{error}</p>}
      <div ref={end} />
    </div>
    {providers.length > 0 && <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void send(input); }}>
      <label htmlFor="reader-question" className="sr-only">向阅读助手提问</label>
      <textarea id="reader-question" placeholder="针对选定资料提问…" value={input} maxLength={20000} disabled={loading}
        onChange={event => setInput(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); }
        }} />
      <div><span>回答附带资料引用</span>{busy
        ? <button type="button" className="assistant-send" aria-label="停止生成" onClick={() => { requestNumber.current++; abort.current?.(); abort.current = null; setBusy(false); setStopped(true); }}><Square size={13} /></button>
        : <button className="assistant-send" disabled={!input.trim() || !providerId} aria-label="发送问题"><ArrowUp size={17} /></button>}</div>
      {sessionId && <Link className="assistant-full-session" to={"/chat/" + sessionId}>在完整会话中继续<ExternalLink size={11} /></Link>}
    </form>}
  </aside>;
}
