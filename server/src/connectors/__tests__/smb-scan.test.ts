import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { Client } from "node-smb2";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SyncContext } from "../types.js";

let temp: string;
let connector: typeof import("../smb.js").default;
beforeAll(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "kb-smb-scan-"));
  process.env.DATA_DIR = temp;
  connector = (await import("../smb.js")).default;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

function fakeServer(failAll: boolean) {
  const directories = new Map<string, string>();
  const read = new Set<string>();
  const opened: string[] = [];
  const item = (filename: string, type: "Directory" | "File") => ({ filename, type, fileSize: BigInt(10), creationTime: new Date(), lastWriteTime: new Date(), changeTime: new Date() });
  const tree = { async request(header: { type: number }, body: { buffer?: Buffer; fileId?: string }) {
    if (header.type === 5) {
      const pathname = body.buffer!.toString("utf16le");
      opened.push(pathname);
      if (pathname.endsWith("\\a-denied") || (failAll && pathname !== "root")) throw new Error("STATUS_ACCESS_DENIED sensitive-password");
      directories.set(pathname, pathname);
      return { body: { fileId: pathname } };
    }
    if (header.type === 14) {
      const pathname = directories.get(body.fileId!)!;
      if (read.has(pathname)) throw { header: { status: 0x80000006 } };
      read.add(pathname);
      return { data: pathname === "root" ? [item("./a-denied", "Directory"), item("./b-allowed", "Directory")] : [item("./专业资料.txt", "File")] };
    }
    return {};
  } };
  vi.spyOn(Client.prototype, "authenticate").mockResolvedValue({ async connectTree() { return tree; } } as never);
  return opened;
}
function context(logs: string[]): SyncContext { return { sourceId: "source", userId: "user", since: null, signal: new AbortController().signal, onProgress() {}, log(message) { logs.push(message); } }; }
const config = { host: "nas", share: "docs", username: "user", password: "sensitive-password", basePath: "root" };

it("fails a scan when every nested directory is unreadable and redacts diagnostic logs", async () => {
  const opened = fakeServer(true);
  const logs: string[] = [];
  const scan = connector.scan(config, context(logs));
  await expect(scan.next()).rejects.toThrow("未读取任何文件");
  expect(opened).toContain("root\\a-denied");
  expect(opened).toContain("root\\b-allowed");
  expect(logs.join(" ")).toContain("STATUS_ACCESS_DENIED");
  expect(logs.join(" ")).not.toContain(config.password);
});

it("traverses normalized subdirectories and reports incomplete coverage when one fails", async () => {
  fakeServer(false);
  const scan = connector.scan(config, context([]));
  const first = await scan.next();
  expect(first.done).toBe(false);
  if (first.done) throw new Error("Expected scanned file");
  expect(first.value.title).toBe("专业资料");
  expect(first.value.externalId).toBe("root/b-allowed/专业资料.txt");
  const end = await scan.next();
  expect(end.done).toBe(true);
  if (!end.done) throw new Error("Expected summary");
  expect(end.value.complete).toBe(false);
  expect(end.value.note).toContain("无法访问");
});
