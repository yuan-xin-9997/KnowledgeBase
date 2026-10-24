import { readdir, readFile, realpath, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Connector, LoadedContent, ScanItem, ScanSummary, SyncContext } from "./types.js";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_SCAN_EXTENSIONS,
  extractText,
  mimeTypeForExtension,
  normalizeExtension,
  titleFromFileName,
} from "./extract.js";

/** Directories that are never worth indexing; compared case-insensitively. */
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

export interface LocalConfig {
  path: string;
  includeExtensions: string[];
  excludeGlobs: string[];
  maxFileSizeMb: number;
  maxFiles: number;
  followSymlinks: boolean;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? [item] : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseExtensions(value: unknown): string[] {
  const list = readStringList(value)
    .flatMap((item) => item.split(/[,;\s]+/))
    .map((item) => normalizeExtension(item))
    .filter(Boolean);
  if (list.length === 0) return [...DEFAULT_SCAN_EXTENSIONS];
  return [...new Set(list)];
}

function numberOption(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseLocalConfig(config: Record<string, unknown>): LocalConfig {
  const rawPath = typeof config.path === "string" ? config.path.trim() : "";
  if (!rawPath) throw new Error("请填写要扫描的目录路径");
  return {
    path: resolve(rawPath),
    includeExtensions: parseExtensions(config.includeExtensions),
    excludeGlobs: readStringList(config.excludeGlobs),
    maxFileSizeMb: numberOption(config.maxFileSizeMb, 100, 1, 2048),
    maxFiles: Math.floor(numberOption(config.maxFiles, 20_000, 1, 500_000)),
    followSymlinks: config.followSymlinks === true || config.followSymlinks === "true",
  };
}

/** Convert a glob into a RegExp. Supports `**`, `*` and `?`. */
export function compileGlob(glob: string): RegExp | null {
  const source = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!source) return null;
  let pattern = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        if (source[index + 2] === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  const flags = process.platform === "win32" ? "i" : "";
  try {
    return new RegExp(`^${pattern}$`, flags);
  } catch {
    return null;
  }
}

interface ExcludeMatcher {
  paths: RegExp[];
  basenames: RegExp[];
}

export function buildExcludeMatcher(globs: string[]): ExcludeMatcher {
  const paths: RegExp[] = [];
  const basenames: RegExp[] = [];
  for (const glob of globs) {
    const regex = compileGlob(glob);
    if (!regex) continue;
    if (glob.includes("/") || glob.includes("\\")) paths.push(regex);
    else basenames.push(regex);
  }
  return { paths, basenames };
}

export function isExcluded(matcher: ExcludeMatcher, relPath: string, name: string): boolean {
  return (
    matcher.paths.some((regex) => regex.test(relPath)) ||
    matcher.basenames.some((regex) => regex.test(name))
  );
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

function createdAt(stats: Stats): string | null {
  const birth = stats.birthtime?.getTime?.() ?? 0;
  if (birth > 0) {
    const iso = toIso(stats.birthtime);
    if (iso) return iso;
  }
  return toIso(stats.ctime);
}

export function fileErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "路径不存在";
    if (code === "EACCES" || code === "EPERM") return "没有访问权限";
    if (code === "ENOTFOUND" || code === "EHOSTDOWN" || code === "ENETUNREACH") {
      return "无法连接网络共享，请确认共享已挂载或网络可用";
    }
    return error.message;
  }
  return String(error);
}

interface ScanState {
  config: LocalConfig;
  matcher: ExcludeMatcher;
  extensions: Set<string>;
  signal: AbortSignal;
  seen: number;
  skipped: number;
  oversized: number;
  unreadable: number;
  hitLimit: boolean;
}

interface RawFile {
  absPath: string;
  relPath: string;
  name: string;
  stats: Stats;
}

function shouldEnterDirectory(name: string, relPath: string, state: ScanState): boolean {
  if (EXCLUDED_DIRECTORIES.has(name.toLowerCase())) return false;
  if (isExcluded(state.matcher, relPath, name)) return false;
  return true;
}

function extensionOf(name: string): string {
  return normalizeExtension(extname(name));
}

async function* walkDirectory(
  dirPath: string,
  relDir: string,
  depth: number,
  state: ScanState,
  ancestors: Set<string>,
): AsyncGenerator<RawFile> {
  ensureNotAborted(state.signal);
  if (depth > MAX_DEPTH) { state.unreadable += 1; return; }
  let entries: Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    state.unreadable += 1;
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (state.seen >= state.config.maxFiles) {
      state.hitLimit = true;
      return;
    }
    ensureNotAborted(state.signal);
    const name = entry.name;
    const relPath = relDir ? `${relDir}/${name}` : name;
    const absPath = join(dirPath, name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      if (!state.config.followSymlinks) {
        state.skipped += 1;
        continue;
      }
      try {
        const target = await stat(absPath);
        isDirectory = target.isDirectory();
        isFile = target.isFile();
        if (isDirectory) {
          const real = await realpath(absPath);
          if (ancestors.has(real) || !shouldEnterDirectory(name, relPath, state)) {
            state.skipped += 1;
            continue;
          }
          const nextAncestors = new Set(ancestors);
          nextAncestors.add(real);
          yield* walkDirectory(absPath, relPath, depth + 1, state, nextAncestors);
          continue;
        }
      } catch {
        state.unreadable += 1;
        continue;
      }
    }

    if (isDirectory) {
      if (shouldEnterDirectory(name, relPath, state)) {
        yield* walkDirectory(absPath, relPath, depth + 1, state, ancestors);
      } else {
        state.skipped += 1;
      }
      continue;
    }
    if (!isFile) continue;
    if (isExcluded(state.matcher, relPath, name)) {
      state.skipped += 1;
      continue;
    }
    if (!state.extensions.has(extensionOf(name))) {
      state.skipped += 1;
      continue;
    }
    let fileStats: Stats;
    try {
      fileStats = await stat(absPath);
    } catch {
      state.unreadable += 1;
      continue;
    }
    if (!fileStats.isFile()) continue;
    if (state.seen >= state.config.maxFiles) {
      state.hitLimit = true;
      return;
    }
    state.seen += 1;
    yield { absPath, relPath, name, stats: fileStats };
  }
}

function buildItem(file: RawFile, state: ScanState): ScanItem {
  const extension = extensionOf(file.name);
  const mimeType = mimeTypeForExtension(extension);
  const title = titleFromFileName(file.name);
  const size = file.stats.size;
  const maxBytes = state.config.maxFileSizeMb * 1024 * 1024;
  const oversized = size > maxBytes;
  if (oversized) state.oversized += 1;
  const sourceCreatedAt = createdAt(file.stats);
  const sourceUpdatedAt = toIso(file.stats.mtime);

  const load = async (): Promise<LoadedContent> => {
    ensureNotAborted(state.signal);
    const fresh = await stat(file.absPath);
    if (fresh.size > maxBytes) {
      return {
        title,
        mimeType,
        size: fresh.size,
        content: "",
        contentFormat: "text",
        sourceCreatedAt,
        sourceUpdatedAt: toIso(fresh.mtime),
        metadata: {
          sizeExceeded: true,
          note: `文件超过 ${state.config.maxFileSizeMb} MB 上限，未抽取正文`,
        },
      };
    }
    const buffer = await readFile(file.absPath);
    const extracted = await extractText({
      buffer,
      filePath: file.absPath,
      mimeType,
      extension,
      maxChars: DEFAULT_MAX_CHARS,
    });
    return {
      title: title || extracted.title,
      mimeType: extracted.mimeType ?? mimeType,
      size: fresh.size,
      content: extracted.content,
      contentFormat: extracted.contentFormat,
      sourceCreatedAt,
      sourceUpdatedAt: toIso(fresh.mtime),
      metadata: {
        ...(extracted.metadata ?? {}),
        relativePath: file.relPath,
      },
    };
  };

  return {
    externalId: file.relPath,
    kind: "file",
    title,
    description: file.relPath,
    mimeType: mimeType ?? null,
    size,
    sourceCreatedAt,
    sourceUpdatedAt,
    filePath: file.absPath,
    metadata: {
      relativePath: file.relPath,
      extension,
      ...(oversized ? { sizeExceeded: true } : {}),
    },
    load,
  };
}

const connector: Connector = {
  type: "local",
  label: "本地 / 挂载目录",
  description: "扫描已挂载到服务器的目录（支持 Windows UNC 路径与 Linux 挂载点）",
  async test(config) {
    let parsed: LocalConfig;
    try {
      parsed = parseLocalConfig(config);
    } catch (error) {
      return { ok: false, message: fileErrorMessage(error) };
    }
    try {
      const stats = await stat(parsed.path);
      if (!stats.isDirectory()) {
        return { ok: false, message: `路径不是目录：${parsed.path}` };
      }
      const entries = await readdir(parsed.path, { withFileTypes: true });
      const samples = entries.slice(0, 5).map((entry) => entry.name);
      return {
        ok: true,
        message: `目录可访问，顶层共 ${entries.length} 个条目`,
        meta: {
          path: parsed.path,
          samples,
          fileCount: entries.filter((entry) => entry.isFile()).length,
          directoryCount: entries.filter((entry) => entry.isDirectory()).length,
        },
      };
    } catch (error) {
      return {
        ok: false,
        message: `无法访问目录：${fileErrorMessage(error)}`,
        meta: { path: parsed.path },
      };
    }
  },
  async *scan(config, ctx: SyncContext): AsyncGenerator<ScanItem, ScanSummary> {
    const parsed = parseLocalConfig(config);
    const state: ScanState = {
      config: parsed,
      matcher: buildExcludeMatcher(parsed.excludeGlobs),
      extensions: new Set(parsed.includeExtensions),
      signal: ctx.signal,
      seen: 0,
      skipped: 0,
      oversized: 0,
      unreadable: 0,
      hitLimit: false,
    };
    const startedAt = Date.now();
    let scanned = 0;

    ensureNotAborted(ctx.signal);
    for await (const file of walkDirectory(parsed.path, "", 0, state, new Set())) {
      ensureNotAborted(ctx.signal);
      scanned += 1;
      if (scanned % 50 === 0) {
        ctx.onProgress({ processed: scanned, current: file.relPath });
      }
      yield buildItem(file, state);
    }
    ctx.onProgress({ processed: scanned });

    const notes: string[] = [];
    let complete = true;
    if (state.hitLimit) {
      complete = false;
      notes.push(`已达到单次扫描上限 ${parsed.maxFiles} 个文件，请缩小目录范围或提高 maxFiles`);
    }
    if (state.unreadable > 0) {
      complete = false;
      notes.push(`${state.unreadable} 个文件或目录无法访问`);
    }
    if (state.oversized > 0) {
      notes.push(`${state.oversized} 个文件超过 ${parsed.maxFileSizeMb} MB，仅记录文件信息`);
    }
    if (scanned === 0) {
      notes.push("目录中没有匹配的文件");
    } else {
      notes.push(`用时 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒`);
    }
    for (const line of notes) ctx.log(`扫描 ${parsed.path}：${line}`);

    return {
      complete,
      scanned,
      skipped: state.skipped,
      note: notes.join("；"),
    };
  },
};

export default connector;
