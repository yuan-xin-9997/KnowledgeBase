import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { api } from "../../lib/api";
import type { FolderEntry } from "../../lib/types";
import { folderStateKey, readPreference, writePreference } from "../../lib/library";

interface Expansion { all: boolean; paths: string[]; collapsed: string[] }
export default function FolderNavigation({ sourceId, userId, selected, reload, onSelect }: {
  sourceId: string; userId: string; selected: string; reload: number; onSelect: (folder: string | null) => void;
}) {
  const key = folderStateKey(userId, sourceId);
  const [state, setState] = useState<Expansion>(() => {
    const saved = readPreference<Partial<Expansion>>(key, {});
    return { all: saved.all === true, paths: Array.isArray(saved.paths) ? saved.paths.filter(p => typeof p === "string") : [], collapsed: Array.isArray(saved.collapsed) ? saved.collapsed.filter(p => typeof p === "string") : [] };
  });
  const [branches, setBranches] = useState<Record<string, { items: FolderEntry[]; total: number }>>({});
  const [trail, setTrail] = useState<FolderEntry[]>([]);
  const revealed = useRef("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const generation = useRef(0);
  const pending = useRef(new Set<string>());
  const viewport = useRef<HTMLDivElement>(null);
  const load = async (parent: string, offset = 0) => {
    if (pending.current.has(parent)) return;
    pending.current.add(parent);
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const value = await api.documents.folders(sourceId, parent === "*" ? undefined : parent, offset);
      if (current === generation.current) setBranches(previous => ({ ...previous, [parent]: { items: offset ? [...(previous[parent]?.items || []), ...value.items] : value.items, total: value.total } }));
    } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : "目录加载失败"); }
    finally { if (current === generation.current) { pending.current.delete(parent); setBusy(pending.current.size > 0); } }
  };
  useEffect(() => {
    generation.current++; pending.current.clear(); setBranches({});
    void load("");
    return () => { generation.current++; };
  }, [sourceId, reload]);
  useEffect(() => { writePreference(key, state); }, [key, state]);
  useEffect(() => {
    let active = true;
    revealed.current = "";
    setTrail([]);
    if (selected) void api.documents.folders(sourceId, undefined, 0, selected).then(value => { if (active) setTrail(value.items); }).catch(() => {});
    const parts = selected.split("/");
    const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    setState(previous => ({ ...previous, paths: [...new Set([...previous.paths, ...ancestors])], collapsed: previous.collapsed.filter(path => !ancestors.includes(path)) }));
    return () => { active = false; };
  }, [selected, sourceId, reload]);
  useEffect(() => {
    if (state.all) { if (!branches["*"]) void load("*"); }
    else for (const path of state.paths) if (!branches[path]) void load(path);
  }, [state, branches, reload]);
  const rows = useMemo(() => {
    const all = branches["*"]?.items;
    const children = new Map<string, FolderEntry[]>();
    for (const entry of all || []) {
      const parent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      const entries = children.get(parent) || []; entries.push(entry); children.set(parent, entries);
    }
    const result: Array<{ entry?: FolderEntry; parent: string; depth: number }> = [];
    const visit = (parent: string, depth: number) => {
      const branch = branches[parent];
      const loaded = state.all && all ? (children.get(parent) || []) : branch?.items || [];
      const extra = trail.filter(entry => (entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "") === parent && !loaded.some(item => item.path === entry.path));
      const items = [...loaded, ...extra].sort((a, b) => a.path.localeCompare(b.path));
      for (const entry of items) {
        result.push({ entry, parent, depth });
        const expanded = state.all ? !state.collapsed.includes(entry.path) : state.paths.includes(entry.path);
        if (entry.hasChildren && expanded) visit(entry.path, depth + 1);
      }
      if ((!state.all || !all) && branch && branch.items.length < branch.total) result.push({ parent, depth });
    };
    visit("", 0); return result;
  }, [branches, state, trail]);
  useEffect(() => {
    const index = rows.findIndex(row => row.entry?.path === selected);
    if (index >= 0 && viewport.current && revealed.current !== selected) { viewport.current.scrollTop = index * 32; revealed.current = selected; }
  }, [rows, selected]);
  const start = Math.max(0, Math.floor(scrollTop / 32) - 3);
  const visible = rows.slice(start, start + 16);
  useEffect(() => { if (viewport.current && scrollTop > rows.length * 32) viewport.current.scrollTop = 0; }, [rows.length, scrollTop]);
  return <nav className="source-folders" aria-label="来源文件夹">
    <div className="source-folder-controls">
      <button className={!selected ? "active" : ""} onClick={() => onSelect(null)}><FolderOpen size={14} />全部文件夹</button>
      <div><button onClick={() => setState({ all: true, paths: [], collapsed: [] })}>全部展开</button><button onClick={() => setState({ all: false, paths: [], collapsed: [] })}>全部收起</button></div>
    </div>
    <p className="folder-count-note">数量包含子目录</p>
    {error && <p role="alert">{error}<button onClick={() => { void load(""); for (const path of state.paths) void load(path); if (state.all) void load("*"); }}>重试加载</button></p>}
    <div className="folder-viewport" ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} aria-busy={busy}>
      <div style={{ height: rows.length * 32, position: "relative" }}>
        {visible.map(({ entry, parent, depth }, index) => {
          const expanded = entry && (state.all ? !state.collapsed.includes(entry.path) : state.paths.includes(entry.path));
          return <div key={entry?.path || parent + "/more"} className="source-folder-row" style={{ position: "absolute", top: (start + index) * 32, height: 32, width: "100%", paddingLeft: 12 + depth * 16 }}>
            {!entry ? <button disabled={busy} onClick={() => void load(parent, branches[parent].items.length)}>加载更多文件夹…</button> : <>
              {entry.hasChildren ? <button className="source-folder-toggle" aria-label={(expanded ? "收起 " : "展开 ") + entry.path} aria-expanded={expanded} onClick={() => setState(previous => {
                const field = previous.all ? "collapsed" : "paths";
                return { ...previous, [field]: previous[field].includes(entry.path) ? previous[field].filter(path => path !== entry.path) : [...previous[field], entry.path] };
              })}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="source-folder-spacer" />}
              <button title={entry.path} className={selected === entry.path ? "active" : ""} aria-current={selected === entry.path ? "location" : undefined} onClick={() => onSelect(entry.path)}>
                {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}<span className="folder-name">{entry.path.split("/").at(-1)}</span><span className="folder-count">{entry.count}</span>
              </button>
            </>}
          </div>;
        })}
      </div>
    </div>
    {busy && <p className="folder-count-note" role="status">正在加载目录…</p>}
  </nav>;
}
