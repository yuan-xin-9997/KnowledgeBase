import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Sparkles } from "lucide-react";

export default function QuickAsk() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    navigate(`/chat?q=${encodeURIComponent(value)}`);
  };

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius)] border border-[#2a313c] p-5 shadow-[var(--shadow-md)]"
      style={{ background: "linear-gradient(150deg, #181c22 0%, #1e242c 58%, #161a20 100%)" }}
      aria-labelledby="quick-ask-title"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full border border-[#3a3f48]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-4 -top-6 h-20 w-20 rounded-full border border-[#333944]"
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-[#d9c49b]">
          <Sparkles size={15} aria-hidden />
          <h2 id="quick-ask-title" className="font-display text-[15px] font-semibold tracking-wide">
            快速提问
          </h2>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[#948e81]">
          用一句话开始，AI 会先检索你的知识库，再给出带出处的回答。
        </p>
        <form onSubmit={submit} className="mt-4 flex items-center gap-2">
          <label htmlFor="quick-ask" className="sr-only">
            输入要向知识库提出的问题
          </label>
          <input
            id="quick-ask"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：最近收录了哪些内容？"
            className="min-w-0 flex-1 rounded-lg border border-[#343a44] bg-[#11151a] px-3 py-2.5 text-[13px] text-[#ece6d9] placeholder:text-[#6f6a5f] transition focus:border-[var(--accent)] focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn btn-accent btn-icon h-10 w-10 shrink-0"
            aria-label="开始提问"
            disabled={!question.trim()}
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-[10.5px] tracking-wide text-[#6b6559]">
          按 Enter 跳转至 AI 会话
        </p>
      </div>
    </section>
  );
}
