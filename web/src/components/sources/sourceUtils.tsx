import { Bookmark, BookOpen, FolderOpen, Server, type LucideIcon } from "lucide-react";
import { ApiError } from "../../lib/api";
import type { Source, SourceType } from "../../lib/types";

export interface SourceTypeMeta {
  type: SourceType;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const fallbackSourceTypes: SourceTypeMeta[] = [
  {
    type: "local",
    label: "本地 / 挂载目录",
    description: "扫描服务器可访问的本地目录，支持 UNC 路径与网络挂载点。",
    icon: FolderOpen,
  },
  {
    type: "smb",
    label: "SMB 共享",
    description: "直接连接 NAS 或 Samba 共享，按需填写账号与子目录。",
    icon: Server,
  },
  {
    type: "cubox",
    label: "Cubox",
    description: "通过 API 扩展链接同步 Cubox 收藏、正文与标注。",
    icon: Bookmark,
  },
  {
    type: "yuque",
    label: "语雀",
    description: "使用 Token 同步语雀知识库文档，支持限定仓库范围。",
    icon: BookOpen,
  },
];

const SOURCE_TYPE_SET = new Set<string>(["local", "smb", "cubox", "yuque"]);

export function isSourceType(value: string): value is SourceType {
  return SOURCE_TYPE_SET.has(value);
}

export function mergeSourceTypes(
  apiTypes: Array<{ type: string; label: string; description: string }>,
): SourceTypeMeta[] {
  const byType = new Map(
    apiTypes
      .filter((item) => isSourceType(item.type))
      .map((item) => [item.type as SourceType, item] as const),
  );
  return fallbackSourceTypes.map((fallback) => {
    const remote = byType.get(fallback.type);
    if (!remote) return fallback;
    return {
      ...fallback,
      label: remote.label?.trim() || fallback.label,
      description: remote.description?.trim() || fallback.description,
    };
  });
}

export function sourceTypeMeta(type: SourceType, types: SourceTypeMeta[]): SourceTypeMeta {
  return types.find((item) => item.type === type) ?? fallbackSourceTypes.find((item) => item.type === type) ?? fallbackSourceTypes[0];
}

export const sourceTypeChipClass: Record<SourceType, string> = {
  local: "chip-accent",
  smb: "bg-[#e8f0ef] text-[var(--teal)] border border-[#d3e2df]",
  cubox: "bg-[#f5eadc] text-[#8a5a2b] border border-[#ead7c1]",
  yuque: "chip-success",
};

export interface StatusMeta {
  kind: "running" | "queued" | "success" | "error" | "idle";
  label: string;
  chipClass: string;
}

export function sourceStatus(source: Source): StatusMeta {
  if (source.activeJob) {
    return source.activeJob.status === "queued"
      ? { kind: "queued", label: "排队中", chipClass: "chip-accent" }
      : { kind: "running", label: "同步中", chipClass: "chip-accent" };
  }
  switch (source.lastSyncStatus) {
    case "success":
      return { kind: "success", label: "同步成功", chipClass: "chip-success" };
    case "error":
      return { kind: "error", label: "同步失败", chipClass: "chip-danger" };
    case "running":
      return { kind: "running", label: "同步中", chipClass: "chip-accent" };
    case "queued":
      return { kind: "queued", label: "排队中", chipClass: "chip-accent" };
    default:
      return { kind: "idle", label: "尚未同步", chipClass: "chip-outline" };
  }
}

export function jobStatusMeta(status: string): StatusMeta {
  switch (status) {
    case "success":
      return { kind: "success", label: "成功", chipClass: "chip-success" };
    case "error":
      return { kind: "error", label: "失败", chipClass: "chip-danger" };
    case "running":
      return { kind: "running", label: "同步中", chipClass: "chip-accent" };
    case "queued":
      return { kind: "queued", label: "排队中", chipClass: "chip-accent" };
    default:
      return { kind: "idle", label: status || "未知", chipClass: "chip-outline" };
  }
}

export function configString(
  config: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

export function configNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function configBool(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

export function configList(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || typeof item === "number")
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value === "string") return parseList(value);
  return [];
}

export function configListText(config: Record<string, unknown>, key: string): string {
  return configList(config, key).join(", ");
}

export function parseList(value: string): string[] {
  return [...new Set(value.split(/[,，;；\n]+/).map((item) => item.trim()).filter(Boolean))];
}

export function parseExtensions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，;；\s]+/)
        .map((item) => item.trim().replace(/^\.+/, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function configuredSecret(source: Source | null, key: string): boolean {
  if (!source || !source.secretFields.includes(key)) return false;
  const masked = source.config[key];
  return typeof masked === "string" && masked.length > 0;
}

export function maskedSecret(source: Source | null, key: string): string {
  if (!source) return "";
  const masked = source.config[key];
  return typeof masked === "string" ? masked : "";
}

export function syncIntervalLabel(minutes: number): string {
  if (!minutes || minutes <= 0) return "仅手动";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "每天" : `每 ${days} 天`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "每小时" : `每 ${hours} 小时`;
  }
  return `每 ${minutes} 分钟`;
}

function joinWindowsPath(host: string, share: string, basePath: string): string {
  const root = host
    ? host.startsWith("\\\\")
      ? host.replace(/\\+$/, "")
      : `\\\\${host.replace(/^\\+/, "")}`
    : "";
  const parts = [root, share.replace(/^[\\/]+|[\\/]+$/g, "")].filter(Boolean);
  const base = basePath.replace(/^[\\/]+|[\\/]+$/g, "");
  if (base) parts.push(base);
  return parts.join("\\");
}

export function sourceLocation(source: Source): string {
  switch (source.type) {
    case "local": {
      const path = configString(source.config, "path").trim();
      return path || "未填写目录路径";
    }
    case "smb": {
      const host = configString(source.config, "host").trim();
      const share = configString(source.config, "share").trim();
      const basePath = configString(source.config, "basePath").trim();
      if (!host && !share) return "未填写共享地址";
      return joinWindowsPath(host, share, basePath) || "未填写共享地址";
    }
    case "cubox": {
      const folders = configList(source.config, "folderIds").length;
      const tags = configList(source.config, "tagIds").length;
      if (folders) return `Cubox · ${folders} 个收藏夹`;
      if (tags) return `Cubox · ${tags} 个标签`;
      return "Cubox · 全部收藏";
    }
    case "yuque": {
      const login = configString(source.config, "login").trim();
      const repos = configList(source.config, "repoIds").length;
      if (login && repos) return `语雀 · ${login} · ${repos} 个知识库`;
      if (login) return `语雀 · ${login}`;
      if (repos) return `语雀 · ${repos} 个知识库`;
      return "语雀 · 自动识别账号";
    }
    default:
      return "";
  }
}

export function formatAbsoluteTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return "不到 1 秒";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}

const META_LABELS: Record<string, string> = {
  count: "数量",
  total: "总计",
  folders: "文件夹",
  folderCount: "文件夹数",
  files: "文件",
  fileCount: "文件数",
  samples: "样例",
  sample: "样例",
  items: "条目",
  itemCount: "条目数",
  docs: "文档",
  docCount: "文档数",
  user: "账号",
  username: "账号",
  login: "登录名",
  name: "名称",
  space: "知识库",
  spaces: "知识库",
  version: "版本",
  path: "路径",
  host: "主机",
  share: "共享",
  tags: "标签",
  note: "说明",
  message: "说明",
};

export function metaLabel(key: string): string {
  return META_LABELS[key] ?? key;
}

export function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    const visible = value.slice(0, 3).map((item) => formatMetaValue(item));
    const suffix = value.length > 3 ? ` 等 ${value.length} 项` : "";
    return `${visible.join("、")}${suffix}`;
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    } catch {
      return "—";
    }
  }
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function formatStatsSummary(stats: {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}): string {
  return `扫描 ${stats.scanned} · 新增 ${stats.created} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 错误 ${stats.errors}`;
}

function detailsText(details: unknown): string {
  if (!details) return "";
  if (typeof details === "string") return details;
  if (Array.isArray(details)) {
    return details
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const message = typeof record.message === "string" ? record.message : "";
          const path = Array.isArray(record.path)
            ? record.path.join(".")
            : typeof record.path === "string"
              ? record.path
              : "";
          if (message) return path ? `${path}：${message}` : message;
          try {
            return JSON.stringify(record);
          } catch {
            return "";
          }
        }
        return String(item);
      })
      .filter(Boolean)
      .slice(0, 4)
      .join("；");
  }
  if (typeof details === "object") {
    try {
      return JSON.stringify(details);
    } catch {
      return "";
    }
  }
  return String(details);
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = detailsText(error.details);
    return detail ? `${error.message}（${detail}）` : error.message;
  }
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试";
}
