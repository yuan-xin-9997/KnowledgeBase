import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";
import type { DocumentDetail } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { readPreference, writePreference } from "../../lib/library";
import { documentOutline, passageOffset } from "../../lib/reading";
import ReaderImage from "./ReaderImage";
import Highlight from "./Highlight";

interface MdNode { type: string; value?: string; children?: MdNode[]; position?: { start: { offset?: number } }; data?: { hName?: string; hProperties?: Record<string, unknown> } }
function readerPlugin(terms: string[]): Plugin {
  const pattern = terms.length ? new RegExp("(" + terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi") : null;
  const visit = (node: MdNode) => {
    if (["paragraph", "heading", "listItem", "code"].includes(node.type)) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, "data-offset": node.position?.start.offset || 0 } };
    if (!node.children || ["code", "inlineCode", "html"].includes(node.type)) return;
    node.children = node.children.flatMap(child => {
      if (child.type === "text" && child.value && pattern) return child.value.split(pattern).map((value, index) => index % 2 ? { type: "readerMark", data: { hName: "mark" }, children: [{ type: "text", value }] } : { type: "text", value });
      visit(child); return [child];
    });
  };
  return () => tree => visit(tree as unknown as MdNode);
}

export default function ReadingBody({ document, query = "", passage = "", scrollRoot }: {
  document: DocumentDetail; query?: string; passage?: string; scrollRoot?: RefObject<HTMLDivElement | null>;
}) {
  const { user } = useAuth();
  const key = `kb:reading:${user?.id}:${document.id}`;
  const restored = useRef(false);
  const saved = useRef(readPreference<{ top?: number; limit?: number }>(key, {}));
  const [limit, setLimit] = useState(Math.max(60000, Math.min(document.content?.length || 60000, Number(saved.current.limit) || 60000)));
  const [progress, setProgress] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [jump, setJump] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = document.content || "";
  const terms = useMemo(() => [...new Set(query.match(/[\p{L}\p{N}_-]+/gu) || [])].slice(0, 12), [query]);
  const plugin = useMemo(() => readerPlugin(terms), [terms]);
  const markdownComponents = useMemo<Components>(() => ({
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <ReaderImage src={src} alt={alt} document={document} />,
  }), [document]);
  const outline = useMemo(() => document.contentFormat === "markdown" ? documentOutline(content) : [], [content, document.contentFormat]);
  const offset = passageOffset(content, passage);
  const requestJump = (value: number) => { setLimit(previous => Math.max(previous, Math.min(content.length, value + 60000))); setJump(value); };
  useEffect(() => {
    if (offset >= 0) requestJump(offset);
    else if (terms.length) { const first = content.toLowerCase().indexOf(terms[0].toLowerCase()); if (first >= 0) requestJump(first); }
  }, [passage, query, content]);
  useEffect(() => {
    if (jump === null || !body.current) return;
    const elements = [...body.current.querySelectorAll<HTMLElement>("[data-offset]")];
    const element = elements.filter(item => Number(item.dataset.offset) <= jump).at(-1) || elements[0];
    element?.scrollIntoView({ block: "center" });
    element?.classList.add("reading-target");
    const timer = window.setTimeout(() => { element?.classList.remove("reading-target"); setJump(null); }, 3000);
    return () => window.clearTimeout(timer);
  }, [jump, limit]);
  useEffect(() => {
    const root = scrollRoot?.current;
    const target = root || window;
    const max = () => root ? root.scrollHeight - root.clientHeight : globalThis.document.documentElement.scrollHeight - window.innerHeight;
    const top = () => root ? root.scrollTop : window.scrollY;
    let timer = 0;
    const store = () => { saved.current = { top: top(), limit }; writePreference(key, saved.current); };
    const update = () => {
      setProgress(Math.round(Math.max(0, Math.min(100, top() / Math.max(1, max()) * Math.min(1, limit / Math.max(1, content.length)) * 100))));
      window.clearTimeout(timer); timer = window.setTimeout(store, 300);
    };
    if (!restored.current) { restored.current = true; if (!query && !passage) { if (root) root.scrollTop = Number(saved.current.top) || 0; else window.scrollTo(0, Number(saved.current.top) || 0); } }
    target.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(() => setProgress(Math.round(Math.max(0, Math.min(100, top() / Math.max(1, max()) * Math.min(1, limit / Math.max(1, content.length)) * 100)))));
    if (body.current) resize.observe(body.current);
    window.addEventListener("pagehide", store);
    return () => { target.removeEventListener("scroll", update); window.removeEventListener("pagehide", store); resize.disconnect(); window.clearTimeout(timer); store(); };
  }, [key, limit, scrollRoot, query, passage]);
  let lineOffset = 0;
  return <div className="reading-body">
    <div className="reading-tools"><span>阅读进度 {progress}%{limit < content.length ? " · 正文尚未全部载入" : ""}</span><button onClick={() => { if (scrollRoot?.current) scrollRoot.current.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 }); }}>回到顶部</button>{outline.length > 0 && <button aria-expanded={outlineOpen} onClick={() => setOutlineOpen(value => !value)}>文章大纲</button>}</div>
    {outlineOpen && <nav className="reading-outline" aria-label="文章大纲">{outline.map(item => <button key={item.offset} style={{ paddingLeft: 8 + (item.level - 1) * 12 }} onClick={() => requestJump(item.offset)}>{item.title}</button>)}</nav>}
    {passage && offset < 0 && <p role="status">原文可能已更新，未能定位引用片段。</p>}
    <div ref={body} className={"prose-kb reader-content " + (document.contentFormat === "markdown" ? "" : "reader-plain")}>
      {document.contentFormat === "markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm, plugin]} components={markdownComponents}>{content.slice(0, limit)}</ReactMarkdown> : content.slice(0, limit).split("\n").map((line, index) => { const start = lineOffset; lineOffset += line.length + 1; return <span key={index} data-offset={start}><Highlight text={line} terms={terms} />{"\n"}</span>; })}
    </div>
    {limit < content.length && <button className="reading-load-more" onClick={() => setLimit(value => value + 60000)}>继续载入正文（{limit.toLocaleString()} / {content.length.toLocaleString()} 字符）</button>}
  </div>;
}
