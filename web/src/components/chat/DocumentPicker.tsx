import { useEffect, useState } from "react";
import { FileText, Loader2, Plus, Search } from "lucide-react";
import { api } from "../../lib/api";
import { formatDate, kindLabel } from "../../lib/format";
import type { Source } from "../../lib/types";

export interface DocumentMeta {
  id: string;
  title: string;
  sourceName: string;
}

export default function DocumentPicker({
  selectedIds,
  onAdd,
  sources,
}: {
  selectedIds: string[];
  onAdd: (document: DocumentMeta) => void;
  sources: Source[];
}) {
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [items, setItems] = useState<
    Array<DocumentMeta & { kind: string; date: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const handle = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      api.documents
        .picker({ q: query.trim() || undefined, sourceId: sourceId || undefined, limit: 10 })
        .then((result) => {
          if (!alive) return;
          setItems(
            result.items.map((item) => ({
              id: item.id,
              title: item.title,
              sourceName: item.sourceName,
              kind: item.kind,
              date: item.date,
            })),
          );
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          setError(cause instanceof Error ? cause.message : "文档检索失败");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 260);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [query, sourceId]);

  const trimmed = query.trim();
  const unselected = items.filter((item) => !selectedIds.includes(item.id));

  return (
    <div className="flex flex-col gap-2">
      <select className="select text-xs" aria-label="文档所属来源" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
        <option value="">全部来源的文档</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
      <label className="relative block">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
        />
        <input
          aria-label="搜索并添加文档"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索并添加文档…"
          maxLength={300}
          className="input h-9 pl-9 text-[12.5px]"
        />
        {loading && (
          <Loader2
            size={13}
            className="spin absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
          />
        )}
      </label>

      {error ? (
        <p className="text-[11.5px] text-[var(--danger)]">{error}</p>
      ) : !loading && unselected.length === 0 ? (
        <p className="px-1 py-1 text-[11.5px] text-[var(--muted-2)]">
          {trimmed ? "没有匹配的文档。" : "没有更多可添加的文档。"}
        </p>
      ) : (
        <div className="flex max-h-[210px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--card)] p-1">
          {unselected.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                onAdd({ id: item.id, title: item.title, sourceName: item.sourceName })
              }
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--paper-2)]"
            >
              <FileText size={13} className="shrink-0 text-[var(--muted-2)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] leading-5">{item.title}</span>
                <span className="block truncate text-[10.5px] text-[var(--muted-2)]">
                  {item.sourceName} · {kindLabel(item.kind)}
                  {item.date ? ` · ${formatDate(item.date)}` : ""}
                </span>
              </span>
              <Plus
                size={13}
                className="shrink-0 text-[var(--accent-strong)] opacity-0 transition group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
