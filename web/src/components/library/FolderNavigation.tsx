import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { visibleFolders } from "../../lib/library";

export default function FolderNavigation({ folders, selected, error, onSelect }: {
  folders: string[]; selected: string; error: string; onSelect: (folder: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => visibleFolders(folders, collapsed), [folders, collapsed]);
  useEffect(() => {
    // Reveal a folder opened from a saved view or browser navigation.
    const parts = selected.split("/");
    setCollapsed(previous => {
      const next = new Set(previous);
      parts.slice(0, -1).forEach((_, index) => next.delete(parts.slice(0, index + 1).join("/")));
      return next;
    });
  }, [selected]);
  return <nav className="source-folders" aria-label="来源文件夹">
    <div className="source-folder-controls">
      <button className={!selected ? "active" : ""} onClick={() => onSelect(null)}><FolderOpen size={14} />全部文件夹</button>
      {folders.length > 0 && <div>
        <button onClick={() => setCollapsed(new Set())}>全部展开</button>
        <button onClick={() => setCollapsed(new Set(folders))}>全部收起</button>
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    {rows.map(({ path, hasChildren, depth }) => {
      const expanded = !collapsed.has(path);
      return <div key={path} className="source-folder-row" style={{ paddingLeft: 12 + depth * 16 }}>
        {hasChildren ? <button className="source-folder-toggle" aria-label={(expanded ? "收起 " : "展开 ") + path}
          aria-expanded={expanded} onClick={() => setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
          })}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          : <span className="source-folder-spacer" />}
        <button title={path} className={selected === path ? "active" : ""} aria-current={selected === path ? "location" : undefined}
          onClick={() => onSelect(path)}>{hasChildren && expanded ? <FolderOpen size={14} /> : <Folder size={14} />}{path.split("/").at(-1)}</button>
      </div>;
    })}
  </nav>;
}
