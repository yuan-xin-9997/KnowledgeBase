import { useEffect, useRef, useState } from "react";
import { documentImageUrl } from "../../lib/library";
import type { DocumentDetail } from "../../lib/types";

export default function ReaderImage({ src, alt, document }: { src?: string; alt?: string; document: DocumentDetail }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [reason, setReason] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const url = documentImageUrl(src, document);
  const retryUrl = attempt && url?.startsWith("/api/") ? url + "&retry=" + attempt : url;
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const diagnose = async () => {
    setFailed(true); setReason("图片地址失效、访问受限或格式不受浏览器支持");
    if (url?.startsWith("/api/")) try {
      const response = await fetch(url);
      if (!response.ok) { const value = await response.json(); setReason(value.error || "图片读取失败"); }
    } catch { setReason("网络连接失败，请稍后重试"); }
  };
  return <span className="reader-image">
    {failed || !url ? <span className="reader-image-error" role="status">{alt || "图片"}：{reason || "图片地址不可用"}<button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重试</button></span>
      : <button type="button" className="reader-image-open" aria-label={"放大图片 " + (alt || "")} onClick={() => { setZoom(1); setOpen(true); }}><img key={attempt} src={retryUrl} alt={alt || ""} loading="lazy" referrerPolicy="no-referrer" onError={() => void diagnose()} /></button>}
    <dialog ref={dialog} className="image-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <span className="image-dialog-tools"><button type="button" onClick={() => setZoom(value => Math.max(0.25, value - 0.25))}>缩小</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom(value => Math.min(4, value + 0.25))}>放大</button><button type="button" onClick={() => setZoom(1)}>适应窗口</button><button type="button" autoFocus onClick={() => setOpen(false)}>关闭</button></span>
      {open && <span className="image-dialog-viewport"><img src={retryUrl} alt={alt || ""} referrerPolicy="no-referrer" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} /></span>}
    </dialog>
  </span>;
}
