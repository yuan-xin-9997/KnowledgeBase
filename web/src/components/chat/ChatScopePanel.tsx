import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Ban,
  Check,
  Database,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ChatScope, Source } from "../../lib/types";
import { formatNumber } from "../../lib/format";
import DocumentPicker, { type DocumentMeta } from "./DocumentPicker";

const MODES: Array<{
  value: ChatScope["mode"];
  label: string;
  description: string;
  icon: typeof Layers;
}> = [
  { value: "all", label: "全部知识库", description: "检索所有已索引内容", icon: Layers },
  { value: "sources", label: "指定来源", description: "只在这些来源内检索", icon: Database },
  { value: "documents", label: "指定文档", description: "只根据选中的文档回答", icon: FileText },
  { value: "none", label: "不使用知识库", description: "纯模型对话，不检索引用", icon: Ban },
];

function normalize(scope: ChatScope): ChatScope {
  return {
    mode: scope.mode,
    sourceIds: [...scope.sourceIds],
    documentIds: [...scope.documentIds],
  };
}

function scopeKey(scope: ChatScope): string {
  return [scope.mode, [...scope.sourceIds].sort().join(","), [...scope.documentIds].sort().join(",")].join(
    "|",
  );
}

export default function ChatScopePanel({
  scope,
  sources,
  documents,
  sourcesLoading,
  saving,
  onSave,
  onClose,
}: {
  scope: ChatScope;
  sources: Source[];
  documents: DocumentMeta[];
  sourcesLoading?: boolean;
  saving?: boolean;
  onSave: (scope: ChatScope) => Promise<void> | void;
  onClose?: () => void;
}) {
  const key = useMemo(() => scopeKey(scope), [scope]);
  const [draft, setDraft] = useState<ChatScope>(() => normalize(scope));

  useEffect(() => {
    setDraft(normalize(scope));
    // The serialized key is the source of truth for external scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const dirty = scopeKey(draft) !== key;

  const setMode = (mode: ChatScope["mode"]) => {
    setDraft((current) => ({ ...current, mode }));
  };

  const toggleSource = (id: string) => {
    setDraft((current) => ({
      ...current,
      sourceIds: current.sourceIds.includes(id)
        ? current.sourceIds.filter((sourceId) => sourceId !== id)
        : [...current.sourceIds, id],
    }));
  };

  const addDocument = (document: DocumentMeta) => {
    setDraft((current) =>
      current.documentIds.includes(document.id)
        ? current
        : { ...current, documentIds: [...current.documentIds, document.id] },
    );
  };

  const removeDocument = (id: string) => {
    setDraft((current) => ({
      ...current,
      documentIds: current.documentIds.filter((documentId) => documentId !== id),
    }));
  };

  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );

  const selectedSources = sources.filter((source) => draft.sourceIds.includes(source.id));

  return (
    <div className="flex h-full flex-col bg-[var(--card)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-4 py-3.5">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <SlidersHorizontal size={14} className="text-[var(--accent-strong)]" />
            知识范围
          </div>
          <p className="mt-1 text-[11.5px] leading-5 text-[var(--muted-2)]">
            AI 只会读取你选择的内容，并在回答中附上引用。
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted-2)] transition hover:bg-[var(--paper-2)] hover:text-[var(--ink)]"
            aria-label="关闭知识范围"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3.5 py-4">
        <div className="flex flex-col gap-1.5">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const checked = draft.mode === mode.value;
            return (
              <label
                key={mode.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                  checked
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]/50"
                    : "border-[var(--line)] bg-[var(--card)] hover:border-[var(--line-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name="chat-scope-mode"
                  value={mode.value}
                  checked={checked}
                  onChange={() => setMode(mode.value)}
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--accent-strong)]"
                />
                <Icon
                  size={14}
                  className={`mt-0.5 shrink-0 ${
                    checked ? "text-[var(--accent-strong)]" : "text-[var(--muted-2)]"
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium leading-5">{mode.label}</span>
                  <span className="block text-[10.5px] leading-4 text-[var(--muted-2)]">
                    {mode.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {draft.mode === "sources" && (
          <div className="fade-up flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
                选择来源
              </span>
              <span className="text-[10.5px] text-[var(--muted-2)]">
                已选 {selectedSources.length}
              </span>
            </div>
            {sourcesLoading ? (
              <div className="flex items-center gap-2 px-1 py-2 text-[11.5px] text-[var(--muted-2)]">
                <Loader2 size={12} className="spin" /> 载入来源…
              </div>
            ) : sources.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-3 text-[11.5px] leading-5 text-[var(--muted-2)]">
                还没有信息来源。
                <Link to="/sources" className="ml-1 text-[var(--accent-strong)] underline">
                  去添加
                </Link>
              </p>
            ) : (
              <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-[var(--line)] p-1">
                {sources.map((source) => {
                  const checked = draft.sourceIds.includes(source.id);
                  return (
                    <label
                      key={source.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[var(--paper-2)]"
                    >
                      <input
                        type="checkbox"
                        className="checkbox h-3.5 w-3.5 shrink-0"
                        checked={checked}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px]">{source.name}</span>
                      <span className="shrink-0 text-[10.5px] text-[var(--muted-2)]">
                        {formatNumber(source.docCount)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {draft.mode === "documents" && (
          <div className="fade-up flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
                已选文档
              </span>
              <span className="text-[10.5px] text-[var(--muted-2)]">
                {draft.documentIds.length} 篇
              </span>
            </div>

            {draft.documentIds.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-3 text-[11.5px] leading-5 text-[var(--muted-2)]">
                还没有选择文档，从下方搜索添加。
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {draft.documentIds.map((id) => {
                  const document = documentById.get(id);
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2.5 py-1.5"
                    >
                      <FileText size={12} className="shrink-0 text-[var(--accent-strong)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] leading-5">
                          {document?.title || "正在载入…"}
                        </span>
                        {document?.sourceName && (
                          <span className="block truncate text-[10px] text-[var(--muted-2)]">
                            {document.sourceName}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => removeDocument(id)}
                        className="shrink-0 rounded p-1 text-[var(--muted-2)] transition hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                        title="移除"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <DocumentPicker selectedIds={draft.documentIds} onAdd={addDocument} sources={sources} />
          </div>
        )}

        {draft.mode === "none" && (
          <div className="fade-up flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--muted)]">
            <FolderOpen size={13} className="mt-0.5 shrink-0 text-[var(--muted-2)]" />
            将只使用模型自身知识回答，不会产生引用来源。
          </div>
        )}

        {draft.mode === "all" && (
          <div className="fade-up flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[11.5px] leading-5 text-[var(--muted)]">
            <Check size={13} className="mt-0.5 shrink-0 text-[var(--success)]" />
            检索全部 {formatNumber(sources.reduce((sum, source) => sum + source.docCount, 0))} 篇内容，
            由 AI 自动挑选相关片段。
          </div>
        )}
      </div>

      <div className="border-t border-[var(--line)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[10.5px] text-[var(--muted-2)]">
          <span>{dirty ? "范围已修改，别忘记保存" : "范围已同步"}</span>
          {saving && <Loader2 size={12} className="spin" />}
        </div>
        <button
          onClick={() => void onSave(draft)}
          disabled={!dirty || saving}
          className="btn btn-primary w-full btn-sm"
        >
          {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
          保存知识范围
        </button>
      </div>
    </div>
  );
}
