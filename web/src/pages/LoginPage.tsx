import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Bot, Database, Loader2, LockKeyhole, Mail, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const target = (location.state as { from?: string } | null)?.from || "/";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(account, password);
      } else {
        await register({ email, username, password, displayName: displayName || undefined });
      }
      navigate(target, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-[var(--paper)]">
      <div className="relative hidden w-[46%] overflow-hidden bg-[var(--ink)] lg:flex lg:flex-col">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 22% 18%, rgba(98,133,255,0.25), transparent 34%), radial-gradient(circle at 78% 76%, rgba(81,147,229,0.18), transparent 36%)",
          }}
        />
        <div className="relative flex h-full flex-col px-14 py-12 text-[#dce5f5]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#3b3f47] bg-[#1e232a]">
              <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
                <path
                  d="M6 24V10l10 6.5L26 10v14"
                  stroke="#8ca7ff"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
                <path d="M6 24h20" stroke="#6880b1" strokeWidth="1.4" />
              </svg>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold tracking-wide text-[#f2f5ff]">知屿</div>
              <div className="text-[10px] tracking-[0.22em] text-[#788ba8]">KNOWLEDGE ISLE</div>
            </div>
          </div>

          <div className="my-auto max-w-[440px]">
            <div className="mb-5 h-px w-14 bg-[#8ca7ff]" />
            <h1 className="font-display text-[40px] font-medium leading-[1.25] text-[#f2f5ff]">
              让散落各处的资料，
              <br />
              汇成一座可对话的岛屿。
            </h1>
            <p className="mt-5 text-[14.5px] leading-7 text-[#95a6c3]">
              聚合 NAS 文件、Cubox 收藏、语雀文档与更多来源，用统一检索与 AI
              会话，把个人知识重新组织起来。
            </p>

            <div className="mt-10 grid gap-4">
              {[
                { icon: Database, title: "多源聚合", desc: "SMB / 本地目录 / Cubox / 语雀" },
                { icon: BookOpen, title: "全文检索", desc: "标题、正文、附件与时间筛选" },
                { icon: Bot, title: "有据可依的 AI", desc: "引用原文，按来源或单篇提问" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex items-start gap-3.5">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-[#343a43] bg-[#1b2027]">
                      <Icon size={15} className="text-[#8ca7ff]" />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-[#d1ddf2]">{item.title}</div>
                      <div className="mt-0.5 text-[12px] text-[#8d9ebc]">{item.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-[11px] tracking-wide text-[#788ba8]">
            PRIVATE · SELF-HOSTED · YOUR DATA STAYS YOURS
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[390px] fade-up">
          <div className="mb-8 lg:hidden">
            <div className="font-display text-2xl font-semibold">知屿</div>
            <div className="mt-1 text-xs tracking-[0.18em] text-[var(--muted-2)]">
              KNOWLEDGE ISLE
            </div>
          </div>

          <div className="mb-7">
            <h2 className="font-display text-[27px] font-semibold text-[var(--ink)]">
              {mode === "login" ? "欢迎回来" : "创建你的知识库"}
            </h2>
            <p className="mt-2 text-[13.5px] text-[var(--muted)]">
              {mode === "login"
                ? "登录后继续整理与探索你的知识。"
                : "第一个注册的账号将自动成为管理员。"}
            </p>
          </div>

          <div className="mb-6 flex rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-1">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setMode(item);
                  setError("");
                }}
                className={`flex-1 rounded-lg py-2 text-[13px] font-medium transition ${
                  mode === item
                    ? "bg-[var(--card)] text-[var(--ink)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "login" ? (
              <label className="field">
                <span className="label">邮箱或用户名</span>
                <div className="relative">
                  <User
                    size={15}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
                  />
                  <input
                    className="input pl-10"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="username"
                    required
                  />
                </div>
              </label>
            ) : (
              <>
                <label className="field">
                  <span className="label">邮箱</span>
                  <div className="relative">
                    <Mail
                      size={15}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
                    />
                    <input
                      className="input pl-10"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="field">
                    <span className="label">用户名</span>
                    <input
                      className="input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="yuanxin"
                      minLength={3}
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label className="field">
                    <span className="label">昵称（可选）</span>
                    <input
                      className="input"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      placeholder="显示名称"
                    />
                  </label>
                </div>
              </>
            )}

            <label className="field">
              <span className="label">密码</span>
              <div className="relative">
                <LockKeyhole
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
                />
                <input
                  className="input pl-10"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "register" ? 8 : 1}
                  required
                />
              </div>
            </label>

            {error && (
              <div className="rounded-lg border border-[#efd2cd] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--danger)]">
                {error}
              </div>
            )}

            <button className="btn btn-primary mt-1 h-11 w-full" disabled={busy} type="submit">
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <>
                  {mode === "login" ? "进入知识库" : "创建账号"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-[11.5px] leading-6 text-[var(--muted-2)]">
            数据仅存储在你自己的服务器上。
            <br />
            Knowledge Base · Self-hosted
          </p>
        </div>
      </div>
    </div>
  );
}
