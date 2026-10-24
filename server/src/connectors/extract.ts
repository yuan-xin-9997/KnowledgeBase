import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { posix as posixPath } from "node:path";
import chardet from "chardet";
import iconv from "iconv-lite";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

/** Default upper bound for extracted body text (the sync engine slices to 2M as a last resort). */
export const DEFAULT_MAX_CHARS = 1_800_000;

/** Extensions the built-in file connectors scan when the user does not configure a list. */
export const DEFAULT_SCAN_EXTENSIONS: string[] = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "rtf",
  "epub",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "java",
  "c",
  "cpp",
  "h",
  "go",
  "rs",
  "rb",
  "php",
  "sh",
  "css",
  "scss",
  "sql",
  "ini",
  "conf",
  "vue",
  "svelte",
];

/** Extensions handled as plain (encoding-detected) text. */
const TEXT_EXTENSIONS = new Set<string>([
  "txt",
  "text",
  "md",
  "markdown",
  "mdx",
  "html",
  "htm",
  "xhtml",
  "xml",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "csv",
  "tsv",
  "log",
  "sql",
  "ini",
  "conf",
  "cfg",
  "toml",
  "env",
  "properties",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "java",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hpp",
  "go",
  "rs",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "bat",
  "cmd",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "tex",
  "rst",
  "diff",
  "patch",
  "gradle",
  "dockerfile",
  "makefile",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  epub: "application/epub+zip",
  rtf: "application/rtf",
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  html: "text/html",
  htm: "text/html",
  xhtml: "application/xhtml+xml",
  xml: "application/xml",
  json: "application/json",
  jsonl: "application/x-ndjson",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  sql: "application/sql",
  ini: "text/plain",
  conf: "text/plain",
  cfg: "text/plain",
  properties: "text/plain",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  vue: "text/plain",
  svelte: "text/plain",
  css: "text/css",
  scss: "text/x-scss",
  sass: "text/x-sass",
  less: "text/x-less",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  cc: "text/x-c++",
  hpp: "text/x-c++",
  go: "text/x-go",
  rs: "text/x-rust",
  rb: "text/x-ruby",
  php: "text/x-php",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  ps1: "text/plain",
  bat: "text/plain",
  cmd: "text/plain",
  tex: "text/x-tex",
  rst: "text/x-rst",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  webm: "video/webm",
  flv: "video/x-flv",
  wmv: "video/x-ms-wmv",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
  iso: "application/x-iso9660-image",
  exe: "application/vnd.microsoft.portable-executable",
  dll: "application/vnd.microsoft.portable-executable",
  msi: "application/x-msi",
  apk: "application/vnd.android.package-archive",
  dmg: "application/x-apple-diskimage",
  pkg: "application/octet-stream",
  bin: "application/octet-stream",
  db: "application/octet-stream",
  sqlite: "application/vnd.sqlite3",
};

/** Binary formats we deliberately never extract text from. */
const BINARY_EXTENSIONS = new Set<string>([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "heic",
  "tif",
  "tiff",
  "ico",
  "psd",
  "raw",
  "cr2",
  "nef",
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "wma",
  "mp4",
  "mkv",
  "mov",
  "avi",
  "webm",
  "flv",
  "wmv",
  "m4v",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
  "iso",
  "exe",
  "dll",
  "msi",
  "apk",
  "dmg",
  "pkg",
  "bin",
  "so",
  "dylib",
  "class",
  "jar",
  "war",
  "db",
  "sqlite",
  "sqlite3",
  "mdb",
  "accdb",
  "swf",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

export interface ExtractInput {
  buffer?: Buffer;
  filePath?: string;
  mimeType?: string;
  extension?: string;
  maxChars?: number;
}

export interface ExtractResult {
  content: string;
  contentFormat: "text" | "markdown" | "html";
  title?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/** Lower-case extension without the leading dot. */
export function normalizeExtension(extension?: string | null): string {
  if (!extension) return "";
  return extension.trim().toLowerCase().replace(/^\.+/, "");
}

export function mimeTypeForExtension(extension?: string | null): string | undefined {
  const ext = normalizeExtension(extension);
  return ext ? MIME_BY_EXTENSION[ext] : undefined;
}

/** File name without extension; underscores become spaces for a nicer title. */
export function titleFromFileName(filePath: string): string {
  const name = basename(filePath);
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  const cleaned = stem.replace(/_+/g, " ").trim();
  return cleaned || name;
}

export function isTextExtension(extension?: string | null): boolean {
  return TEXT_EXTENSIONS.has(normalizeExtension(extension));
}

export function isMarkdownExtension(extension?: string | null): boolean {
  return MARKDOWN_EXTENSIONS.has(normalizeExtension(extension));
}

function normalizeEncoding(name: string | null | undefined): string {
  const key = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (!key) return "utf-8";
  if (/^utf-?8$/.test(key) || key === "ascii" || key === "us-ascii") return "utf-8";
  if (key === "utf-16" || key === "utf-16le" || key === "utf16le" || key === "ucs-2") {
    return "utf-16le";
  }
  if (key === "utf-16be" || key === "utf16be") return "utf-16be";
  if (/^(gb2312|gbk|gb18030|x-gbk|cp936|gb-18030|windows-936)$/.test(key)) return "gb18030";
  if (/^(big5|big5-hkscs|cp950|windows-950)$/.test(key)) return "big5";
  if (/^(iso-8859-1|latin1|windows-1252|cp1252|iso8859-1)$/.test(key)) return "windows-1252";
  return key;
}

function decodeWithEncoding(buffer: Buffer, encoding: string): string {
  const normalized = normalizeEncoding(encoding);
  try {
    if (normalized === "utf-8") return buffer.toString("utf8");
    if (normalized === "utf-16le") return new TextDecoder("utf-16le").decode(buffer);
    if (normalized === "utf-16be") return new TextDecoder("utf-16be").decode(buffer);
    if (iconv.encodingExists(normalized)) return iconv.decode(buffer, normalized);
  } catch {
    // fall through to UTF-8
  }
  return buffer.toString("utf8");
}

function detectBom(buffer: Buffer): { encoding: string; skip: number } | null {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: "utf-8", skip: 3 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { encoding: "utf-16le", skip: 2 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { encoding: "utf-16be", skip: 2 };
  }
  return null;
}

function hasMultibyteBytes(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte > 0x7f) return true;
  }
  return false;
}

/**
 * Decode a text buffer using BOM, strict UTF-8 and finally chardet + iconv-lite.
 * Handles GBK/GB18030/Big5/UTF-16 files produced by Chinese Windows tools.
 */
export function decodeTextBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length === 0) return { text: "", encoding: "utf-8" };
  const bom = detectBom(buffer);
  if (bom) {
    return { text: decodeWithEncoding(buffer.subarray(bom.skip), bom.encoding), encoding: bom.encoding };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    // Not valid UTF-8: rely on chardet.
  }
  let detected: string | null = null;
  try {
    detected = chardet.detect(buffer.subarray(0, 512 * 1024));
  } catch {
    detected = null;
  }
  let encoding = normalizeEncoding(detected);
  if (!encoding || encoding === "utf-8") {
    // For a non-UTF-8 payload chardet may still answer UTF-8/ASCII; prefer GB18030
    // because it is a superset of ASCII and covers most Chinese legacy files.
    encoding = hasMultibyteBytes(buffer) ? "gb18030" : "utf-8";
  }
  if (!iconv.encodingExists(encoding)) {
    encoding = hasMultibyteBytes(buffer) ? "gb18030" : "utf-8";
  }
  return { text: decodeWithEncoding(buffer, encoding), encoding };
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "dd",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "ul",
  "title",
]);

const DROPPED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "head",
  "meta",
  "link",
]);

interface DomNode {
  type?: string;
  name?: string;
  tagName?: string;
  data?: string;
  children?: DomNode[];
}

function renderDomNode(node: DomNode, out: string[]): void {
  const type = node.type;
  if (type === "text") {
    out.push(node.data ?? "");
    return;
  }
  if (type === "comment" || type === "directive" || type === "cdata") return;
  const name = String(node.name ?? node.tagName ?? "").toLowerCase();
  if (DROPPED_TAGS.has(name)) return;
  if (name === "br") {
    out.push("\n");
    return;
  }
  if (name === "td" || name === "th") {
    for (const child of node.children ?? []) renderDomNode(child, out);
    out.push("\t");
    return;
  }
  const isBlock = BLOCK_TAGS.has(name);
  if (isBlock) out.push("\n");
  for (const child of node.children ?? []) renderDomNode(child, out);
  if (isBlock) out.push("\n");
}

/** Strip scripts/styles and turn an HTML document into readable plain text. */
export function htmlToText(html: string): { text: string; title?: string } {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || undefined;
  $("script, style, noscript, template, svg, canvas, iframe, object, embed, link, meta").remove();
  const out: string[] = [];
  const root = $.root()[0] as unknown as DomNode | undefined;
  if (root) {
    for (const child of root.children ?? []) renderDomNode(child, out);
  }
  return { text: out.join(""), title };
}

function cleanText(input: string, maxChars: number): { content: string; truncated: boolean } {
  let text = input.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
  text = text.replace(/[\u000b\u000c\u001c-\u001f]/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();
  let truncated = false;
  if (maxChars > 0 && text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n\n…（内容过长，已截断）`;
    truncated = true;
  }
  return { content: text, truncated };
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    return named[entity] ?? match;
  });
}

async function extractPdf(buffer: Buffer, maxChars: number): Promise<ExtractResult> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt/i.test(message)) {
      throw new Error("PDF 已加密，无法读取正文");
    }
    throw new Error(`PDF 解析失败：${message}`);
  }
  try {
    const totalPages = pdf.numPages ?? 0;
    const { text } = await extractPdfText(pdf, { mergePages: true });
    const cleaned = cleanText(text ?? "", maxChars);
    return {
      content: cleaned.content,
      contentFormat: "text",
      mimeType: MIME_BY_EXTENSION.pdf,
      metadata: {
        totalPages,
        extension: "pdf",
        ...(totalPages === 0 ? { emptyDocument: true } : {}),
        ...(cleaned.truncated ? { truncated: true } : {}),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF 文本抽取失败：${message}`);
  } finally {
    try {
      const disposable = pdf as unknown as { destroy?: () => Promise<void> | void };
      await disposable.destroy?.();
    } catch {
      // ignore cleanup failures
    }
  }
}

async function extractDocx(buffer: Buffer, maxChars: number): Promise<ExtractResult> {
  const result = await mammoth.extractRawText({ buffer });
  const cleaned = cleanText(result.value ?? "", maxChars);
  return {
    content: cleaned.content,
    contentFormat: "text",
    mimeType: MIME_BY_EXTENSION.docx,
    metadata: {
      extension: "docx",
      paragraphs: cleaned.content ? cleaned.content.split(/\n{2,}/).length : 0,
      ...(cleaned.truncated ? { truncated: true } : {}),
      ...(result.messages?.length ? { warnings: result.messages.length } : {}),
    },
  };
}

function extractSpreadsheet(buffer: Buffer, extension: string, maxChars: number): ExtractResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    sheetRows: 5000,
    cellDates: true,
    cellText: true,
  });
  const sheetNames = workbook.SheetNames.slice(0, 30);
  const parts: string[] = [];
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    parts.push(`## 工作表：${name}\n\n${csv.trim()}`);
  }
  const cleaned = cleanText(parts.join("\n\n"), maxChars);
  return {
    content: cleaned.content,
    contentFormat: "text",
    mimeType: mimeTypeForExtension(extension),
    metadata: {
      extension,
      sheetNames: workbook.SheetNames,
      sheetCount: workbook.SheetNames.length,
      ...(workbook.SheetNames.length > sheetNames.length ? { omittedSheets: true } : {}),
      ...(cleaned.truncated ? { truncated: true } : {}),
    },
  };
}

function parseSlideNumber(path: string): number {
  const match = /slide(\d+)\.xml$/i.exec(path);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function extractPptx(buffer: Buffer, maxChars: number): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => parseSlideNumber(a) - parseSlideNumber(b));
  const parts: string[] = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const paragraphs = xml
      .split(/<\/a:p>/i)
      .map((segment) =>
        [...segment.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
          .map((match) => decodeXmlEntities(match[1]))
          .join(""),
      )
      .map((line) => line.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) continue;
    parts.push(`## 第 ${parseSlideNumber(path)} 页\n\n${paragraphs.join("\n")}`);
  }
  const cleaned = cleanText(parts.join("\n\n"), maxChars);
  return {
    content: cleaned.content,
    contentFormat: "text",
    mimeType: MIME_BY_EXTENSION.pptx,
    metadata: {
      extension: "pptx",
      slideCount: slidePaths.length,
      ...(cleaned.truncated ? { truncated: true } : {}),
    },
  };
}

function resolveZipHref(baseDir: string, href: string): string {
  const decoded = decodeURIComponent(href.split("#")[0]);
  if (decoded.startsWith("/")) return decoded.replace(/^\/+/, "");
  return posixPath.normalize(posixPath.join(baseDir, decoded)).replace(/^\.\//, "");
}

async function extractEpub(buffer: Buffer, maxChars: number): Promise<ExtractResult> {
  const zip = await JSZip.loadAsync(buffer);
  const allPaths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  let opfPath: string | null = null;
  let opfXml = "";

  const container = zip.file("META-INF/container.xml");
  if (container) {
    const containerXml = await container.async("string");
    const $ = cheerio.load(containerXml, { xmlMode: true });
    const fullPath = $("rootfile").first().attr("full-path");
    if (fullPath) {
      opfPath = fullPath;
      opfXml = (await zip.file(fullPath)?.async("string")) ?? "";
    }
  }
  if (!opfPath) {
    opfPath = allPaths.find((path) => /\.opf$/i.test(path)) ?? null;
    if (opfPath) opfXml = (await zip.file(opfPath)?.async("string")) ?? "";
  }

  const ordered: string[] = [];
  let bookTitle: string | undefined;
  if (opfPath && opfXml) {
    const $ = cheerio.load(opfXml, { xmlMode: true });
    bookTitle = $("title").first().text().trim() || undefined;
    const manifest = new Map<string, string>();
    $("manifest > item, item").each((_, element) => {
      const id = $(element).attr("id");
      const href = $(element).attr("href");
      if (id && href) manifest.set(id, href);
    });
    const baseDir = posixPath.dirname(opfPath);
    $("spine > itemref, itemref").each((_, element) => {
      const idref = $(element).attr("idref");
      if (!idref) return;
      const href = manifest.get(idref);
      if (href) ordered.push(resolveZipHref(baseDir, href));
    });
    if (ordered.length === 0) {
      for (const href of manifest.values()) {
        ordered.push(resolveZipHref(baseDir, href));
      }
    }
  }
  if (ordered.length === 0) {
    ordered.push(...allPaths.filter((path) => /\.(x?html?|xhtml)$/i.test(path)).sort());
  }

  const parts: string[] = [];
  const limit = Math.min(ordered.length, 500);
  for (let i = 0; i < limit; i += 1) {
    const path = ordered[i];
    const file = zip.file(path);
    if (!file) continue;
    const html = await file.async("string");
    const { text, title } = htmlToText(html);
    const cleaned = cleanText(text, maxChars);
    if (!cleaned.content) continue;
    parts.push(`## ${title || posixPath.basename(path)}\n\n${cleaned.content}`);
  }
  const cleaned = cleanText(parts.join("\n\n"), maxChars);
  return {
    content: cleaned.content,
    contentFormat: "text",
    title: bookTitle,
    mimeType: MIME_BY_EXTENSION.epub,
    metadata: {
      extension: "epub",
      sections: parts.length,
      ...(ordered.length > limit ? { truncatedSections: true } : {}),
      ...(cleaned.truncated ? { truncated: true } : {}),
    },
  };
}

function decodeLegacyBytes(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return iconv.decode(bytes, "gb18030");
    } catch {
      return bytes.toString("latin1");
    }
  }
}

/** Very small RTF reader: enough for notes exported from Word/WordPad. */
export function rtfToText(buffer: Buffer): string {
  let raw = buffer.toString("latin1");
  // Drop destinations such as {\fonttbl ...}, {\colortbl ...}, {\*\...}
  const destination =
    /\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator)\b[^{}]*\}/gi;
  for (let i = 0; i < 5; i += 1) {
    const next = raw.replace(destination, "");
    if (next === raw) break;
    raw = next;
  }
  raw = raw.replace(/\{\\\*[^{}]*\}/g, "");
  // Hex escapes: \'d6\'d0 -> bytes -> best-effort decode.
  raw = raw.replace(/(?:\\'[0-9a-fA-F]{2})+/g, (match) => {
    const bytes = Buffer.from(match.replace(/\\'/g, ""), "hex");
    return decodeLegacyBytes(bytes);
  });
  raw = raw
    .replace(/\\(?:par|line|sect|page|row)\b ?/gi, "\n")
    .replace(/\\(?:tab|cell|nestcell)\b ?/gi, "\t")
    .replace(/\\u(-?\d+)\??/g, (_, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCharCode(value < 0 ? value + 65536 : value) : "";
    })
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/\\([\\{}])/g, "$1")
    .replace(/[{}]/g, "");
  return raw;
}

function emptyResult(
  extension: string,
  mimeType: string | undefined,
  metadata: Record<string, unknown>,
): ExtractResult {
  return {
    content: "",
    contentFormat: "text",
    mimeType,
    metadata: { extension, ...metadata },
  };
}

/**
 * Extract searchable text from a file buffer or a path on disk.
 * Unsupported / binary formats return an empty body instead of throwing.
 */
export async function extractText(input: ExtractInput): Promise<ExtractResult> {
  const maxChars =
    typeof input.maxChars === "number" && input.maxChars > 0 ? input.maxChars : DEFAULT_MAX_CHARS;
  let buffer = input.buffer;
  if (!buffer) {
    if (!input.filePath) {
      throw new Error("缺少待抽取的文件内容或路径");
    }
    buffer = await readFile(input.filePath);
  }
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);

  const extension = normalizeExtension(
    input.extension ?? (input.filePath ? extname(input.filePath) : ""),
  );
  const mimeType = input.mimeType ?? mimeTypeForExtension(extension);
  const title = input.filePath ? titleFromFileName(input.filePath) : undefined;

  const withTitle = (result: ExtractResult): ExtractResult => ({
    ...result,
    title: result.title ?? title,
  });

  switch (extension) {
    case "pdf": {
      const result = await extractPdf(buffer, maxChars);
      return withTitle(result);
    }
    case "docx": {
      return withTitle(await extractDocx(buffer, maxChars));
    }
    case "xlsx":
    case "xlsm":
    case "xlsb":
    case "xls": {
      return withTitle(extractSpreadsheet(buffer, extension, maxChars));
    }
    case "pptx": {
      return withTitle(await extractPptx(buffer, maxChars));
    }
    case "epub": {
      return withTitle(await extractEpub(buffer, maxChars));
    }
    case "doc":
    case "ppt": {
      return withTitle(
        emptyResult(extension, mimeType, {
          legacyFormat: true,
          note: "旧版 Office 二进制格式（.doc/.ppt）暂不支持正文抽取，仅保留文件信息",
        }),
      );
    }
    case "rtf": {
      const text = rtfToText(buffer);
      const cleaned = cleanText(text, maxChars);
      return withTitle({
        content: cleaned.content,
        contentFormat: "text",
        mimeType: mimeType ?? MIME_BY_EXTENSION.rtf,
        metadata: {
          extension,
          ...(cleaned.truncated ? { truncated: true } : {}),
        },
      });
    }
    case "html":
    case "htm":
    case "xhtml": {
      const { text: decoded } = decodeTextBuffer(buffer);
      const { text, title: htmlTitle } = htmlToText(decoded);
      const cleaned = cleanText(text, maxChars);
      return {
        content: cleaned.content,
        contentFormat: "text",
        title: htmlTitle ?? title,
        mimeType: mimeType ?? MIME_BY_EXTENSION.html,
        metadata: {
          extension,
          sourceFormat: "html",
          ...(cleaned.truncated ? { truncated: true } : {}),
        },
      };
    }
    default:
      break;
  }

  if (BINARY_EXTENSIONS.has(extension)) {
    return withTitle(
      emptyResult(extension, mimeType, {
        binary: true,
        note: "该类型文件不进行正文抽取",
      }),
    );
  }

  const mimeLooksText =
    !extension &&
    Boolean(mimeType) &&
    (/^text\//.test(mimeType!) ||
      /(json|xml|yaml|javascript|sql|ecmascript)/i.test(mimeType!) ||
      mimeType === "application/octet-stream");

  if (isTextExtension(extension) || mimeLooksText) {
    const { text, encoding } = decodeTextBuffer(buffer);
    const cleaned = cleanText(text, maxChars);
    const isMarkdown = isMarkdownExtension(extension);
    let extractedTitle: string | undefined;
    if (!title && isMarkdown) {
      const heading = /^#{1,6}\s+(.+)$/m.exec(cleaned.content);
      extractedTitle = heading?.[1]?.trim() || undefined;
    }
    return {
      content: cleaned.content,
      contentFormat: isMarkdown ? "markdown" : "text",
      title: extractedTitle ?? title,
      mimeType: mimeType ?? "text/plain",
      metadata: {
        extension,
        encoding,
        ...(cleaned.truncated ? { truncated: true } : {}),
      },
    };
  }

  return withTitle(
    emptyResult(extension, mimeType, {
      unsupported: true,
      note: "暂不支持该文件类型的正文抽取，仅保留文件信息",
    }),
  );
}
