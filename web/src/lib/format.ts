export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  };
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    file: "文件",
    article: "文章",
    note: "笔记",
    pdf: "PDF",
    doc: "文档",
    image: "图片",
  };
  return map[kind] ?? kind;
}

export function sourceTypeLabel(type: string): string {
  const map: Record<string, string> = {
    local: "本地目录",
    smb: "SMB 共享",
    cubox: "Cubox",
    yuque: "语雀",
  };
  return map[type] ?? type;
}

export function highlightText(text: string, terms: string[]): Array<{ text: string; match: boolean }> {
  if (!text) return [];
  if (!terms.length) return [{ text, match: false }];
  const escaped = terms
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (!escaped.length) return [{ text, match: false }];
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const lowerTerms = terms.map((term) => term.toLowerCase());
  return text
    .split(regex)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, match: lowerTerms.includes(part.toLowerCase()) }));
}
