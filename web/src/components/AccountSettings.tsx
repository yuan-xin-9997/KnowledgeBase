import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./Toast";
import { api } from "../lib/api";
import { describeApiError } from "./sources/sourceUtils";

export default function AccountSettings() {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDisplayName(user?.displayName ?? ""); }, [user?.displayName]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    try { await api.auth.updateProfile({ displayName: displayName || undefined, password: password || undefined }); await refresh(); setPassword(""); setConfirm(""); toast("账号信息已更新", "success"); }
    catch (reason) { setError(describeApiError(reason)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={save} className="card mt-8 p-5" aria-label="账号设置">
    <h2 className="font-display text-lg font-semibold">账号设置</h2><p className="mt-1 text-xs text-[var(--muted)]">{user?.email} · {user?.role === "admin" ? "管理员" : "用户"}</p>
    <fieldset disabled={busy} className="mt-5 grid gap-4 md:grid-cols-3">
      <label className="field"><span className="label">显示名称</span><input className="input" maxLength={64} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="field"><span className="label">新密码（留空不修改）</span><input className="input" type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="field"><span className="label">确认新密码</span><input className="input" type="password" required={Boolean(password)} minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
    </fieldset>{error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}<button disabled={busy} className="btn btn-ghost mt-4">{busy ? "保存中…" : "保存账号信息"}</button>
  </form>;
}
