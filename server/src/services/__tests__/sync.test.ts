import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let temp: string;
let docsDir: string;
let db: typeof import("../../db.js").db;
let sync: typeof import("../sync.js");
let sources: typeof import("../sources.js");
let sourceId: string;
const userId = "sync-user";

beforeAll(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-"));
  docsDir = path.join(temp, "docs");
  fs.mkdirSync(docsDir);
  process.env.DATA_DIR = path.join(temp, "data");
  db = (await import("../../db.js")).db;
  sources = await import("../sources.js");
  sync = await import("../sync.js");
  db.prepare("INSERT INTO users(id,email,username,password_hash,created_at,role) VALUES(?,?,?,?,?,'admin')").run(userId, "sync@test.local", "syncuser", "x", new Date().toISOString());
  sourceId = sources.createSource(userId, { name: "Docs", type: "local", config: { path: docsDir }, syncIntervalMinutes: 0 }).id;
});
afterAll(() => {
  sync?.stopScheduler();
  db?.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

async function run() {
  const jobId = `test-${crypto.randomUUID()}`;
  db.prepare("INSERT INTO sync_jobs(id,source_id,user_id,status,created_at) VALUES(?,?,?,'queued',?)").run(jobId, sourceId, userId, new Date().toISOString());
  return sync.runJob(userId, sourceId, jobId);
}
function activeCount() { return (db.prepare("SELECT COUNT(*) n FROM documents WHERE source_id = ? AND deleted_at IS NULL").get(sourceId) as { n: number }).n; }

it("preserves unchanged documents, reconciles deletions, and restores a reappearing file", async () => {
  const a = path.join(docsDir, "a.md");
  const b = path.join(docsDir, "b.md");
  fs.writeFileSync(a, "第一篇专业资料");
  fs.writeFileSync(b, "第二篇专业资料");
  const stamp = fs.statSync(a).mtime;
  expect((await run()).created).toBe(2);
  expect(activeCount()).toBe(2);
  const second = await run();
  expect(second.skipped).toBe(2);
  expect(second.deleted).toBe(0);
  expect(activeCount()).toBe(2);
  fs.unlinkSync(a);
  expect((await run()).deleted).toBe(1);
  expect(activeCount()).toBe(1);
  fs.writeFileSync(a, "第一篇专业资料");
  fs.utimesSync(a, stamp, stamp);
  expect((await run()).updated).toBe(1);
  expect(activeCount()).toBe(2);
  sources.updateSource(userId, sourceId, { config: { maxFiles: 1 } });
  const partial = await run();
  expect(partial.complete).toBe(false);
  expect(partial.deleted).toBe(0);
  expect(activeCount()).toBe(2);
  sources.updateSource(userId, sourceId, { config: { maxFiles: 20000 } });
  fs.unlinkSync(a);
  fs.unlinkSync(b);
  expect((await run()).deleted).toBe(2);
  expect(activeCount()).toBe(0);
});

it("reserves a queued sync immediately to reject concurrent starts", async () => {
  const job = sync.startSync(userId, sourceId);
  expect(() => sync.startSync(userId, sourceId)).toThrow("正在同步");
  for (let i = 0; i < 100 && sync.isSourceSyncing(sourceId); i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(sync.getJob(userId, job.id).status).toBe("success");
});
