import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CornerDownLeft, Send, Square } from "lucide-react";

export const CHAT_INPUT_LIMIT = 4000;

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  noProvider,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  noProvider?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? localRef;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value, ref]);

  const overLimit = value.length > CHAT_INPUT_LIMIT;
  const canSend = value.trim().length > 0 && !overLimit && !disabled && !streaming;

  return (
    <div className="border-t border-[var(--line)] bg-[var(--paper)]/80 px-3 pb-3 pt-2.5 backdrop-blur sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {noProvider && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2 text-[11.5px] text-[var(--accent-strong)]">
            <AlertCircle size={13} className="shrink-0" />
            <span className="flex-1 leading-5">还没有配置模型，无法开始对话。</span>
            <Link to="/settings" className="shrink-0 font-medium underline">
              配置模型
            </Link>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-1.5 pl-2 shadow-[var(--shadow-sm)] transition focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(185,133,69,0.12)]">
          <textarea
            aria-label="向知识库提问"
            ref={ref}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            rows={1}
            placeholder={noProvider ? "配置模型后即可提问…" : "向你的知识库提问…"}
            className="max-h-[200px] min-h-[42px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[14px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted-2)]"
          />
          {streaming ? (
            <button
              onClick={onStop}
              className="btn btn-ghost btn-sm mb-0.5 shrink-0"
              title="停止生成"
            >
              <Square size={12} /> 停止
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!canSend}
              className="btn btn-primary btn-icon mb-0.5 shrink-0"
              title="发送"
              aria-label="发送"
            >
              <Send size={15} />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10.5px] text-[var(--muted-2)]">
          <span className="flex items-center gap-1">
            <CornerDownLeft size={10} />
            Enter 发送 · Shift + Enter 换行
          </span>
          <span className={overLimit ? "font-medium text-[var(--danger)]" : ""}>
            {value.length.toLocaleString("zh-CN")} / {CHAT_INPUT_LIMIT.toLocaleString("zh-CN")}
          </span>
        </div>
      </div>
    </div>
  );
}
