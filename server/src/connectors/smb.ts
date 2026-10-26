import { Client } from "node-smb2";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import { config as appConfig } from "../config.js";
import { createAttachmentCache, type AttachmentCache } from "./smb-cache.js";
import type { Connector, LoadedContent, ScanItem, ScanSummary, SyncContext } from "./types.js";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_SCAN_EXTENSIONS,
  extractText,
  mimeTypeForExtension,
  normalizeExtension,
  titleFromFileName,
} from "./extract.js";
import { buildExcludeMatcher, isExcluded, fileErrorMessage, parseExtensions } from "./local.js";

type SmbTree = Awaited<ReturnType<Awaited<ReturnType<Client["authenticate"]>>["connectTree"]>>;
interface DirectoryItem { filename: string; fileSize: BigInt; creationTime: Date; lastWriteTime: Date; changeTime: Date; type: "File" | "Directory" }
interface OpenDirectory { open(path: string): Promise<void>; read(): Promise<DirectoryItem[]>; close(): Promise<void> }
interface OpenFile { open(path: string): Promise<void>; fileSize: bigint; createReadStream(): Readable; close(): Promise<void> }
const require = createRequire(import.meta.url);
// Explicit handles let us enumerate every directory page and await file closure before disconnecting.
const Directory = (require("node-smb2/dist/client/Directory.js") as { default: new (tree: SmbTree) => OpenDirectory }).default;
const File = (require("node-smb2/dist/client/File.js") as { default: new (tree: SmbTree) => OpenFile }).default;

export function smbEntryName(filename: string): string {
  // node-smb2 adds "./" to ordinary leaf names; it is not part of the NAS filename.
  const name = filename.replace(/^\.\//, "");
  if (!name || name === "." || name === ".." || /[\\/\u0000]/.test(name)) throw new Error("SMB目录返回了无效的文件名");
  return name;
}

export async function readAllSmbEntries(directory: Pick<OpenDirectory, "read">): Promise<DirectoryItem[]> {
  const entries: DirectoryItem[] = [];
  const seen = new Set<string>();
  while (true) {
    let page: DirectoryItem[];
    try { page = await directory.read(); }
    catch (error) {
      if ((error as { header?: { status?: number } })?.header?.status === 0x80000006) return entries;
      throw error;
    }
    if (!page.length) return entries;
    for (const entry of page) {
      const item = { ...entry, filename: smbEntryName(entry.filename) };
      if (seen.has(item.filename)) throw new Error("SMB目录分页重复，已停止扫描以保留历史索引");
      seen.add(item.filename);
      entries.push(item);
    }
  }
}

interface SmbClient {
  disconnect(): void;
  readdir(path: string, options: { stats: true }): Promise<SmbEntry[]>;
  readFile(path: string): Promise<Buffer>;
}

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  "target",
  ".idea",
  ".vscode",
  "$recycle.bin",
  "#recycle",
  "system volume information",
]);

const MAX_DEPTH = 32;
const OPERATION_TIMEOUT_MS = 30_000;

export interface SmbConfig {
  host: string;
  share: string;
  username: string;
  password: string;
  domain: string;
  basePath: string;
  includeExtensions: string[];
  excludeGlobs: string[];
  maxFileSizeMb: number;
  maxFiles: number;
  maxCacheSizeMb: number;
}

interface SmbEntry {
  name: string;
  size?: number;
  birthtime?: Date;
  mtime?: Date;
  ctime?: Date;
  atime?: Date;
  isDirectory(): boolean;
}

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBasePath(input: string): string {
  let value = input.trim().replace(/\//g, "\\");
  value = value.replace(/^\\\\[^\\]+\\[^\\]+\\?/, "");
  return value.replace(/^\\+/, "").replace(/\\+$/, "");
}

export function parseSmbConfig(config: Record<string, unknown>): SmbConfig {
  const host = typeof config.host === "string" ? config.host.trim() : "";
  const share = typeof config.share === "string" ? config.share.trim() : "";
  const username = typeof config.username === "string" ? config.username.trim() : "";
  const password = typeof config.password === "string" ? config.password : "";
  if (!host) throw new Error("请填写 SMB 主机地址（IP 或主机名）");
  if (!share) throw new Error("请填写共享名称（share）");
  if (!username) throw new Error("请填写 SMB 用户名");
  return {
    host: host.replace(/^\\+/, ""),
    share: share.replace(/^\\+|\\+$/g, ""),
    username,
    password,
    domain: typeof config.domain === "string" ? config.domain.trim() : "",
    basePath: normalizeBasePath(typeof config.basePath === "string" ? config.basePath : ""),
    includeExtensions: parseExtensions(config.includeExtensions),
    excludeGlobs: Array.isArray(config.excludeGlobs) ? config.excludeGlobs.filter((v): v is string => typeof v === "string") : typeof config.excludeGlobs === "string" ? config.excludeGlobs.split(/[,;\n]/).map(v => v.trim()).filter(Boolean) : [],
    maxFileSizeMb: numberOption(config.maxFileSizeMb, 100, 1, 2048),
    maxFiles: Math.floor(numberOption(config.maxFiles, 20_000, 1, 500_000)),
    maxCacheSizeMb: numberOption(config.maxCacheSizeMb, 1024, 1, 102400),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createClient(config: SmbConfig): SmbClient {
  const client = new Client(config.host, { connectTimeout: OPERATION_TIMEOUT_MS, requestTimeout: OPERATION_TIMEOUT_MS });
  let tree: SmbTree | null = null;
  const connect = async () => {
    if (!tree) {
      const session = await client.authenticate({ username: config.username, password: config.password, domain: config.domain, forceNtlmVersion: "v2" });
      tree = await session.connectTree(config.share);
    }
    return tree;
  };
  const readdir = async (dir: string): Promise<SmbEntry[]> => {
    const directory = new Directory(await connect());
    try {
      await directory.open(dir || "/");
      const entries = await readAllSmbEntries(directory);
      return entries.map(entry => ({ name: entry.filename, size: Number(entry.fileSize), birthtime: entry.creationTime, mtime: entry.lastWriteTime, ctime: entry.changeTime, isDirectory: () => entry.type === "Directory" }));
    } finally { await directory.close(); }
  };
  return {
    disconnect() {
      // Destroy directly: the library can leave failed-auth/request timers pending during close().
      client.socket?.destroy();
      clearTimeout(client.connectTimeoutId);
      for (const timer of client.requestTimeoutIdMap.values()) clearTimeout(timer);
      client.requestTimeoutIdMap.clear();
      client.responseCallbackMap.clear();
      client.responseMap.clear();
    },
    readdir,
    async readFile(filePath) {
      const file = new File(await connect());
      const chunks: Buffer[] = [];
      let size = 0;
      let stream: Readable | undefined;
      try {
        await file.open(filePath);
        if (file.fileSize > BigInt(Math.floor(config.maxFileSizeMb * 1024 * 1024))) throw new Error("文件读取期间超过大小上限");
        stream = file.createReadStream();
        for await (const chunk of stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > config.maxFileSizeMb * 1024 * 1024) throw new Error("文件读取期间超过大小上限");
          chunks.push(buffer);
        }
        return Buffer.concat(chunks, size);
      } finally { stream?.destroy(); await file.close(); }
    },
  };
}

function disconnectQuietly(client: SmbClient): void {
  try {
    client.disconnect();
  } catch {
    // ignore socket cleanup errors
  }
}

function smbError(error: unknown, action: string): Error {
  const status = (error as { header?: { status?: number } })?.header?.status;
  const statusNames: Record<number, string> = { 0xc000006d: "STATUS_LOGON_FAILURE", 0xc0000022: "STATUS_ACCESS_DENIED", 0xc00000cc: "STATUS_BAD_NETWORK_NAME", 0xc0000034: "STATUS_OBJECT_NAME_NOT_FOUND", 0xc000003a: "STATUS_OBJECT_PATH_NOT_FOUND" };
  const raw = error instanceof Error ? error : new Error(status === undefined ? String(error) : statusNames[status] || `SMB_STATUS_0x${status.toString(16)}`);
  const code = String((raw as NodeJS.ErrnoException).code ?? raw.message ?? "");
  let reason: string;
  if (/STATUS_LOGON_FAILURE|STATUS_ACCOUNT_DISABLED|STATUS_PASSWORD_EXPIRED/i.test(code)) {
    reason = "用户名或密码错误";
  } else if (/STATUS_ACCESS_DENIED|STATUS_NETWORK_ACCESS_DENIED/i.test(code)) {
    reason = "没有访问该共享或路径的权限";
  } else if (/STATUS_BAD_NETWORK_NAME|STATUS_OBJECT_PATH_NOT_FOUND/i.test(code)) {
    reason = "共享名称或路径不存在";
  } else if (/ENOTFOUND|EHOSTUNREACH|EHOSTDOWN|ENETUNREACH/i.test(code)) {
    reason = "无法解析或连接主机，请确认 NAS 已开机且网络可达";
  } else if (/ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ECONNRESET/i.test(code)) {
    reason = "连接被拒绝或超时，请确认已开启 SMB 服务（445 端口）";
  } else if (/STATUS_OBJECT_NAME_NOT_FOUND|STATUS_NO_SUCH_FILE/i.test(code)) {
    reason = "文件或目录不存在";
  } else {
    reason = fileErrorMessage(raw);
  }
  return new Error(`${action}失败：${reason}（${code || "未知错误"}）`);
}

async function smbCall<T>(client: SmbClient, action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(run(), OPERATION_TIMEOUT_MS, `${action}超时（${OPERATION_TIMEOUT_MS / 1000} 秒）`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("超时")) throw error;
    throw smbError(error, action);
  }
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("同步已取消");
}

function toIso(value: Date | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  try {
    return value.toISOString();
  } catch {
    return null;
  }
}

function joinSmbPath(dir: string, name: string): string {
  return dir ? `${dir}\\${name}` : name;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? normalizeExtension(name.slice(index + 1)) : "";
}

function displayUrl(config: SmbConfig, relativePosix: string): string {
  const suffix = relativePosix ? `/${relativePosix}` : "";
  return `smb://${config.host}/${config.share}${suffix}`;
}

interface ScanState {
  config: SmbConfig;
  extensions: Set<string>;
  matcher: ReturnType<typeof buildExcludeMatcher>;
  signal: AbortSignal;
  seen: number;
  skipped: number;
  oversized: number;
  unreadable: number;
  hitLimit: boolean;
  client: SmbClient;
  cache: AttachmentCache;
  cacheLimited: number;
  lastDirectoryError: string | null;
  log: (message: string) => void;
}

async function listDirectory(state: ScanState, path: string, isRoot: boolean): Promise<SmbEntry[]> {
  try {
    const entries = await smbCall(state.client, "读取共享目录", () =>
      state.client.readdir(path, { stats: true }),
    );
    return (entries as unknown as SmbEntry[]).filter((entry) => entry && entry.name);
  } catch (error) {
    if (isRoot) throw error;
    state.unreadable += 1;
    const message = error instanceof Error ? error.message : String(error);
    const safe = state.config.password ? message.split(state.config.password).join("***") : message;
    const safePath = state.config.password ? path.split(state.config.password).join("***") : path;
    state.lastDirectoryError = `${safePath}：${safe}`;
    state.log(`无法读取目录 ${state.lastDirectoryError}`);
    return [];
  }
}

async function* walkDirectory(
  state: ScanState,
  dirPath: string,
  relDir: string,
  depth: number,
  isRoot = false,
): AsyncGenerator<{ entry: SmbEntry; smbPath: string; relPath: string }> {
  ensureNotAborted(state.signal);
  if (depth > MAX_DEPTH) { state.unreadable += 1; return; }
  const entries = await listDirectory(state, dirPath, isRoot);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (state.seen >= state.config.maxFiles) {
      state.hitLimit = true;
      return;
    }
    ensureNotAborted(state.signal);
    const name = entry.name;
    const relPath = relDir ? `${relDir}/${name}` : name;
    const smbPath = joinSmbPath(dirPath, name);
    if (isExcluded(state.matcher, relPath, name)) { state.skipped += 1; continue; }
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(name.toLowerCase())) {
        state.skipped += 1;
        continue;
      }
      yield* walkDirectory(state, smbPath, relPath, depth + 1);
      continue;
    }
    if (!state.extensions.has(extensionOf(name))) {
      state.skipped += 1;
      continue;
    }
    if (state.seen >= state.config.maxFiles) {
      state.hitLimit = true;
      return;
    }
    state.seen += 1;
    yield { entry, smbPath, relPath };
  }
}

function buildItem(
  file: { entry: SmbEntry; smbPath: string; relPath: string },
  state: ScanState,
): ScanItem {
  const { entry, smbPath, relPath } = file;
  const config = state.config;
  const extension = extensionOf(entry.name);
  const mimeType = mimeTypeForExtension(extension);
  const title = titleFromFileName(entry.name);
  const size = typeof entry.size === "number" ? entry.size : 0;
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  const oversized = size > maxBytes;
  if (oversized) state.oversized += 1;
  const sourceCreatedAt = toIso(entry.birthtime ?? entry.ctime);
  const sourceUpdatedAt = toIso(entry.mtime);
  const externalId = [config.basePath.replace(/\\/g, "/"), relPath]
    .filter(Boolean)
    .join("/")
    .replace(/^\/+/, "");
  const url = displayUrl(config, externalId);
  const cachePath = state.cache.pathFor(externalId, extension);

  const load = async (): Promise<LoadedContent> => {
    ensureNotAborted(state.signal);
    const client = state.client;
    {
      const info = entry;
      const infoSize = Number((info as unknown as SmbEntry).size ?? 0);
      if (infoSize > maxBytes) {
        return {
          title,
          mimeType,
          size: infoSize,
          content: "",
          contentFormat: "text",
          sourceCreatedAt,
          sourceUpdatedAt,
          metadata: {
            sizeExceeded: true,
            note: `文件超过 ${config.maxFileSizeMb} MB 上限，未抽取正文`,
          },
        };
      }
      const buffer = await smbCall(client, "读取文件", () => client.readFile(smbPath));
      ensureNotAborted(state.signal);
      const cached = await state.cache.store(externalId, extension, buffer);
      if (!cached) state.cacheLimited += 1;
      const extracted = await extractText({
        buffer,
        filePath: entry.name,
        mimeType,
        extension,
        maxChars: DEFAULT_MAX_CHARS,
      });
      return {
        title: title || extracted.title,
        mimeType: extracted.mimeType ?? mimeType,
        size: buffer.length,
        content: extracted.content,
        contentFormat: extracted.contentFormat,
        sourceCreatedAt,
        sourceUpdatedAt: toIso((info as unknown as SmbEntry).mtime) ?? sourceUpdatedAt,
        metadata: {
          ...(extracted.metadata ?? {}),
          relativePath: externalId,
          smbPath: url,
          ...(cached ? {} : { cacheLimitExceeded: true, originalUnavailable: "原件缓存已达容量上限，可提高 maxCacheSizeMb 后重新同步" }),
        },
      };
    }
  };

  return {
    externalId,
    kind: "file",
    title,
    description: relPath,
    mimeType: mimeType ?? null,
    size,
    sourceCreatedAt,
    sourceUpdatedAt,
    filePath: cachePath,
    metadata: {
      relativePath: externalId,
      extension,
      host: config.host,
      share: config.share,
      ...(oversized ? { sizeExceeded: true } : {}),
    },
    load,
  };
}

const connector: Connector = {
  type: "smb",
  label: "SMB 文件服务",
  description: "直接连接 SMB / Samba 共享目录（无需预先挂载）",
  async test(config) {
    let parsed: SmbConfig;
    try {
      parsed = parseSmbConfig(config);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "SMB 配置不完整" };
    }
    let client: SmbClient | null = null;
    try {
      client = createClient(parsed);
      const entries = (await smbCall(client, "连接共享目录", () =>
        client!.readdir(parsed.basePath, { stats: true }),
      )) as unknown as SmbEntry[];
      const samples = entries.slice(0, 5).map((entry) => entry.name);
      return {
        ok: true,
        message: `连接成功，目录内共 ${entries.length} 个条目`,
        meta: {
          host: parsed.host,
          share: parsed.share,
          basePath: parsed.basePath,
          samples,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法连接 SMB 共享",
        meta: { host: parsed.host, share: parsed.share, basePath: parsed.basePath },
      };
    } finally {
      if (client) disconnectQuietly(client);
    }
  },
  async *scan(config, ctx: SyncContext): AsyncGenerator<ScanItem, ScanSummary> {
    const parsed = parseSmbConfig(config);
    const client = createClient(parsed);
    const state: ScanState = {
      config: parsed,
      extensions: new Set(parsed.includeExtensions),
      matcher: buildExcludeMatcher(parsed.excludeGlobs),
      signal: ctx.signal,
      seen: 0,
      skipped: 0,
      oversized: 0,
      unreadable: 0,
      hitLimit: false,
      client,
      cache: await createAttachmentCache(appConfig.dataDir, ctx.userId, ctx.sourceId, parsed.maxCacheSizeMb * 1024 * 1024),
      cacheLimited: 0,
      lastDirectoryError: null,
      log: ctx.log,
    };
    let scanned = 0;
    const startedAt = Date.now();
    try {
      ensureNotAborted(ctx.signal);
      for await (const file of walkDirectory(state, parsed.basePath, "", 0, true)) {
        ensureNotAborted(ctx.signal);
        scanned += 1;
        if (scanned % 50 === 0) {
          ctx.onProgress({ processed: scanned, current: file.relPath });
        }
        yield buildItem(file, state);
      }
      ctx.onProgress({ processed: scanned });
    } finally {
      disconnectQuietly(client);
    }

    if (scanned === 0 && state.unreadable > 0) {
      throw new Error(`扫描失败：${state.unreadable} 个目录无法访问，未读取任何文件${state.lastDirectoryError ? `；${state.lastDirectoryError}` : ""}`);
    }
    const notes: string[] = [];
    let complete = true;
    if (state.hitLimit) {
      complete = false;
      notes.push(`已达到单次扫描上限 ${parsed.maxFiles} 个文件，请缩小目录范围或提高 maxFiles`);
    }
    if (state.unreadable > 0) {
      complete = false;
      notes.push(`${state.unreadable} 个目录无法访问${state.lastDirectoryError ? `：${state.lastDirectoryError}` : ""}`);
    }
    if (state.oversized > 0) {
      notes.push(`${state.oversized} 个文件超过 ${parsed.maxFileSizeMb} MB，仅记录文件信息`);
    }
    if (state.cacheLimited > 0) notes.push(`${state.cacheLimited} 个原件因缓存容量上限未保存，正文已同步；请提高 maxCacheSizeMb 后重新同步`);
    if (scanned === 0) {
      notes.push("共享目录中没有匹配的文件");
    } else {
      notes.push(`用时 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒`);
    }
    for (const line of notes) ctx.log(`扫描 smb://${parsed.host}/${parsed.share}：${line}`);

    return {
      complete,
      scanned,
      skipped: state.skipped,
      note: notes.join("；"),
    };
  },
};

export default connector;
