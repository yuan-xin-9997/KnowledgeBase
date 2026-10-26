import { createHash } from "node:crypto";

export function documentFolder(metadata: string | null, externalId: string, kind: string): string {
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(metadata || "{}"); } catch { /* Older metadata may be invalid. */ }
  const relative = typeof meta.relativePath === "string" ? meta.relativePath : kind === "file" ? externalId : "";
  return relative ? relative.replace(/\\/g, "/").split("/").slice(0, -1).join("/")
    : typeof meta.folder === "string" ? meta.folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
}

export function contentFingerprint(content: string | null): string | null {
  const normalized = (content || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length >= 80 ? createHash("sha256").update(normalized).digest("hex") : null;
}
