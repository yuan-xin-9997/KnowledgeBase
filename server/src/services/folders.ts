import { db } from "../db.js";
import { documentFolder } from "./document-meta.js";

export function sourceFolders(userId: string, sourceId: string, parent?: string, offset = 0, limit = 200, reveal?: string) {
  if (!db.prepare("SELECT 1 FROM sources WHERE id = ? AND user_id = ?").get(sourceId, userId)) return { folders: [], items: [], total: 0 };
  if (db.prepare("SELECT 1 FROM folder_cache_state WHERE source_id = ?").get(sourceId) || !db.prepare("SELECT 1 FROM folder_cache_ready WHERE source_id = ?").get(sourceId)) {
    db.transaction(() => {
      const counts = new Map<string, number>();
      for (const row of db.prepare("SELECT metadata, external_id, kind FROM documents WHERE source_id = ? AND deleted_at IS NULL").iterate(sourceId) as Iterable<{ metadata: string | null; external_id: string; kind: string }>) {
        const parts = documentFolder(row.metadata, row.external_id, row.kind).split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) { const path = parts.slice(0, i).join("/"); counts.set(path, (counts.get(path) || 0) + 1); }
      }
      db.prepare("DELETE FROM folder_counts WHERE source_id = ?").run(sourceId);
      const insert = db.prepare("INSERT INTO folder_counts(source_id,path,parent,count) VALUES(?,?,?,?)");
      for (const [path, count] of counts) insert.run(sourceId, path, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", count);
      db.prepare("DELETE FROM folder_cache_state WHERE source_id = ?").run(sourceId);
      db.prepare("INSERT INTO folder_cache_ready VALUES(?) ON CONFLICT DO NOTHING").run(sourceId);
    })();
  }
  if (reveal) {
    const parts = reveal.split("/").filter(Boolean);
    const paths = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    if (paths.length) {
      const items = db.prepare(`SELECT path, count, EXISTS(SELECT 1 FROM folder_counts child WHERE child.source_id = folder_counts.source_id AND child.parent = folder_counts.path) AS hasChildren FROM folder_counts WHERE source_id = ? AND path IN (${paths.map(() => "?").join(",")}) ORDER BY path`).all(sourceId, ...paths) as Array<{ path: string; count: number; hasChildren: number }>;
      return { folders: items.map(row => row.path), items: items.map(row => ({ ...row, hasChildren: Boolean(row.hasChildren) })), total: items.length };
    }
  }
  const filter = parent === undefined ? "source_id = ?" : "source_id = ? AND parent = ?";
  const params = parent === undefined ? [sourceId] : [sourceId, parent];
  const total = (db.prepare(`SELECT COUNT(*) n FROM folder_counts WHERE ${filter}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT path, count, EXISTS(SELECT 1 FROM folder_counts child WHERE child.source_id = folder_counts.source_id AND child.parent = folder_counts.path) AS hasChildren FROM folder_counts WHERE ${filter} ORDER BY path LIMIT ? OFFSET ?`)
    .all(...params, parent === undefined ? -1 : limit, offset) as Array<{ path: string; count: number; hasChildren: number }>;
  return { folders: rows.map(row => row.path), items: rows.map(row => ({ ...row, hasChildren: Boolean(row.hasChildren) })), total };
}
