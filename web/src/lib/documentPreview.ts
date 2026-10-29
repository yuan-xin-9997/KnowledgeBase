import type { DocumentDetail } from "./types";

export function previewKind(doc: Pick<DocumentDetail, "mimeType" | "kind" | "filePath" | "url">): string | null {
  const mime = doc.mimeType?.split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.startsWith("video/")) return "video";
  const extension = (doc.filePath || doc.url || "").split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "pdf";
  if (extension === "html" || extension === "htm") return "html";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"].includes(extension || "")) return "audio";
  if (["mp4", "webm", "mov", "m4v", "mkv", "avi"].includes(extension || "")) return "video";
  return ["pdf", "audio", "video"].includes(doc.kind) ? doc.kind : null;
}
