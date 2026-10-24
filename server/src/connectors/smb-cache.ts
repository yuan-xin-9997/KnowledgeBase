import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readdir, stat, writeFile, rename, unlink } from "node:fs/promises";

export interface AttachmentCache {
  pathFor(externalId: string, extension: string): string;
  store(externalId: string, extension: string, buffer: Buffer): Promise<boolean>;
}

export function attachmentCacheDirectory(dataDir: string, userId: string, sourceId: string): string {
  if (![userId, sourceId].every(id => /^[A-Za-z0-9_-]+$/.test(id))) throw new Error("无效的附件缓存范围");
  return path.resolve(dataDir, "attachments", userId, sourceId);
}

export async function removeCachedAttachment(dataDir: string, userId: string, sourceId: string, filePath: string | null): Promise<void> {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const dir = attachmentCacheDirectory(dataDir, userId, sourceId);
  if (path.dirname(resolved) !== dir || !/^[a-f0-9]{64}(?:\.[a-z0-9]{1,12})?$/.test(path.basename(resolved))) return;
  await unlink(resolved).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}

export async function createAttachmentCache(dataDir: string, userId: string, sourceId: string, maxBytes: number): Promise<AttachmentCache> {
  const dir = attachmentCacheDirectory(dataDir, userId, sourceId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let used = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) used += (await stat(path.join(dir, entry.name))).size;
  }
  const pathFor = (externalId: string, extension: string) => {
    const hash = crypto.createHash("sha256").update(externalId).digest("hex");
    const suffix = /^[a-z0-9]{1,12}$/i.test(extension) ? `.${extension.toLowerCase()}` : "";
    return path.join(dir, hash + suffix);
  };
  return {
    pathFor,
    async store(externalId, extension, buffer) {
      const target = pathFor(externalId, extension);
      let previous = 0;
      try { previous = (await stat(target)).size; } catch { /* Not cached yet. */ }
      if (used - previous + buffer.length > maxBytes) {
        // An old attachment must not remain downloadable alongside newly indexed content.
        if (previous) { await unlink(target); used -= previous; }
        return false;
      }
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, buffer, { mode: 0o600 });
        await rename(temporary, target);
        used += buffer.length - previous;
        return true;
      } finally { await unlink(temporary).catch(() => {}); }
    },
  };
}
