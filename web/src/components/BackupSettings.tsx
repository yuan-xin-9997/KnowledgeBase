import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { formatBytes, formatDate } from "../lib/format";
import type { BackupStatus } from "../lib/types";

export default function BackupSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => { try { setStatus(await api.backups.list()); } catch (reason) { setError(reason instanceof Error ? reason.message : "备份状态读取失败"); } };
  useEffect(() => { if (user?.role === "admin") void load(); }, [user?.role]);
  if (user?.role !== "admin") return null;
  const act = async (id?: string) => {
    setBusy(true); setError("");
    try { if (id) await api.backups.verify(id); else await api.backups.create(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "备份操作失败"); }
    finally { await load(); setBusy(false); }
  };
  return <section className="card mt-8 p-5" aria-label="备份与恢复"><h2>备份与恢复</h2>
    <p className="mt-2 text-sm">备份系统数据库与加密密钥；创建后自动恢复到临时目录，验证完整性、关联和密钥可用性。</p>
    <p className="mt-2 text-xs">原始信息源不包含在备份中，SMB 附件缓存可重新同步。浏览器内的阅读进度不包含在系统备份中。</p>
    {status?.lastAttempt && <p className="mt-2 text-sm">最近操作：{status.lastAttempt.status === "success" ? "成功" : status.lastAttempt.status === "running" ? "执行中" : "失败"} · {formatDate(status.lastAttempt.time, true)} {status.lastAttempt.error}</p>}
    <div className="my-3 flex gap-2"><button className="btn btn-primary btn-sm" disabled={busy || status?.busy} onClick={() => void act()}>{busy ? "正在处理…" : "创建并验证备份"}</button><button className="btn btn-ghost btn-sm" onClick={() => void load()}>刷新状态</button></div>
    {error && <p role="alert">{error}</p>}
    {status && !status.items.length && <p>尚未创建应用备份。</p>}
    <ul className="backup-list">{status?.items.map(item => <li key={item.id}><span>{formatDate(item.createdAt, true)} · {formatBytes(item.size)}</span><p>{item.error || (item.verification ? item.verification.ok ? `已验证可恢复 · ${item.verification.documents} 篇资料 · ${formatDate(item.verification.verifiedAt, true)}` : "恢复验证失败：" + item.verification.error : "尚未验证")}</p><code>{item.id}</code><button className="btn btn-ghost btn-sm" disabled={busy || status.busy} onClick={() => void act(item.id)}>验证恢复</button></li>)}</ul>
    <details className="mt-4"><summary>恢复操作说明</summary><ol><li>在服务器上使用备份目录运行：<pre>node scripts/restore-backup.mjs &lt;DATA_DIR/backups/备份编号&gt; &lt;新的恢复目录&gt;</pre></li><li>脚本拒绝覆盖已有目录；校验通过后，先停止服务，再将 DATA_DIR 指向新的恢复目录。</li><li>如设置了 APP_SECRET，必须与备份 secret.key 一致；其余环境配置沿用原部署。启动后检查登录、来源及文档，SMB 原件可重新同步。</li></ol></details>
  </section>;
}
