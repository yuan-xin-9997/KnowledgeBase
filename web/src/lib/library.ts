export interface SavedView { id: string; name: string; query: string }

export function cleanExcerpt(value: string, title = ""): string {
  let text = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*(?:\)|$)/g, (_, label: string) =>
      /^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(label.trim()) ? "" : label)
    .replace(/https?:\/\/[^\s<>]+/g, "")
    .replace(/\S*(?:https?%3A%2F%2F|imageUrl=)\S*/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^[\s#>*-]+/gm, "")
    .replace(/[*_\x60~|]/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  if (title && text.startsWith(title)) text = text.slice(title.length).trim();
  return text.slice(0, 240);
}

export function externalUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || "");
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function savedQuery(params: URLSearchParams): string {
  const copy = new URLSearchParams();
  for (const key of ["q", "mode", "sourceId", "folder", "kind", "tag", "from", "to", "sort"]) {
    const value = params.get(key);
    if (value) copy.set(key, value);
  }
  return copy.toString();
}

export function loadSavedViews(userId: string): SavedView[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("kb:views:" + userId) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((view): view is SavedView => view && typeof view.id === "string"
      && typeof view.name === "string" && typeof view.query === "string")
      .slice(0, 12).map(view => ({ ...view, name: view.name.slice(0, 40),
        query: savedQuery(new URLSearchParams(view.query)) }));
  } catch { return []; }
}

export function storeSavedViews(userId: string, views: SavedView[]): void {
  localStorage.setItem("kb:views:" + userId, JSON.stringify(views.slice(0, 12)));
  window.dispatchEvent(new Event("kb:views-changed"));
}

export function documentImageUrl(src: string | undefined, doc: { id: string; sourceType: string; url: string | null }): string | undefined {
  if (!src) return undefined;
  if (/^https?:\/\//i.test(src)) return src;
  if (/^\/\//.test(src)) return "https:" + src;
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src)) return src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return undefined;
  if (["local", "smb"].includes(doc.sourceType)) return `/api/documents/${encodeURIComponent(doc.id)}/image?src=${encodeURIComponent(src)}`;
  try { const url = new URL(src, doc.url || ""); return externalUrl(url.href) || undefined; } catch { return undefined; }
}

export function visibleFolders(folders: string[], collapsed: ReadonlySet<string>) {
  const parents = new Set(folders.filter(value => value.includes("/")).map(value => value.slice(0, value.lastIndexOf("/"))));
  return folders.filter(value => {
    const parts = value.split("/");
    return !parts.slice(0, -1).some((_, index) => collapsed.has(parts.slice(0, index + 1).join("/")));
  }).map(path => ({ path, hasChildren: parents.has(path), depth: path.split("/").length - 1 }));
}
