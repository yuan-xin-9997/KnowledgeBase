import { api } from "../../lib/api";
import type { DocumentDetail } from "../../lib/types";

export default function DocumentPreview({ document: doc, kind }: { document: DocumentDetail; kind: string }) {
  const url = doc.fileAvailable ? api.documents.fileUrl(doc.id) : doc.url;
  if (!url || (!doc.fileAvailable && !/^https?:\/\//i.test(url))) return <p role="status">原文件当前不可用，无法预览。</p>;
  return <div className="space-y-4">
    {kind === "audio" ? <audio key={url} controls preload="metadata" src={url} className="w-full" aria-label={doc.title} />
      : kind === "video" ? <video key={url} controls playsInline preload="metadata" src={url} className="w-full" aria-label={doc.title} />
      : <iframe title={doc.title} src={url} sandbox={kind === "html" ? "" : undefined} className="h-[75vh] w-full border-0" />}
    <p className="text-sm text-[var(--muted)]">无法预览或播放？<a href={url} target="_blank" rel="noopener noreferrer" className="underline">打开原文件</a>（播放支持取决于浏览器和文件编码）。</p>
  </div>;
}
