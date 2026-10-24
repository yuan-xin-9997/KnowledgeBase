import { afterAll, expect, it } from "vitest";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createAttachmentCache, removeCachedAttachment } from "../smb-cache.js";

const temp = await mkdtemp(path.join(os.tmpdir(), "kb-cache-"));
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

it("stores originals atomically, isolates users and hashes paths", async () => {
  const cache = await createAttachmentCache(temp, "u1", "s1", 1024);
  const other = await createAttachmentCache(temp, "u2", "s1", 1024);
  const external = "../../专业文件.pdf";
  expect(await cache.store(external, "pdf", Buffer.from("original PDF bytes"))).toBe(true);
  const filePath = cache.pathFor(external, "pdf");
  expect(path.basename(filePath)).toMatch(/^[a-f0-9]{64}\.pdf$/);
  expect(filePath).not.toBe(other.pathFor(external, "pdf"));
  expect(await readFile(filePath, "utf8")).toBe("original PDF bytes");
  await removeCachedAttachment(temp, "u2", "s1", filePath);
  expect((await stat(filePath)).isFile()).toBe(true);
  await removeCachedAttachment(temp, "u1", "s1", filePath);
  await expect(stat(filePath)).rejects.toThrow();
  await expect(createAttachmentCache(temp, "../escape", "s1", 1024)).rejects.toThrow("无效");
});

it("bounds cache growth and removes stale bytes when a replacement exceeds capacity", async () => {
  const cache = await createAttachmentCache(temp, "u1", "s2", 10);
  expect(await cache.store("a", "txt", Buffer.alloc(6))).toBe(true);
  expect(await cache.store("b", "txt", Buffer.alloc(5))).toBe(false);
  expect(await cache.store("b", "txt", Buffer.alloc(4))).toBe(true);
  expect(await cache.store("a", "txt", Buffer.alloc(7))).toBe(false);
  await expect(stat(cache.pathFor("a", "txt"))).rejects.toThrow();
  expect((await stat(cache.pathFor("b", "txt"))).size).toBe(4);
});

it("builds NTLMv2 authentication under OpenSSL3 without legacy providers", () => {
  const ntlm = createRequire(import.meta.url)("node-smb2/dist/protocol/ntlm/util.js") as { encodeAuthenticationMessage: (username: string, host: string, domain: string, nonce: Buffer, password: string, flags: number, version: string) => Buffer };
  const response = ntlm.encodeAuthenticationMessage("guest", "localhost", "", Buffer.alloc(8), "", 0, "v2");
  expect(response.toString("ascii", 0, 7)).toBe("NTLMSSP");
  expect(response.length).toBeGreaterThan(64);
});

it("reads all SMB directory pages and stops only at end-of-directory", async () => {
  const { readAllSmbEntries } = await import("../smb.js");
  const item = (filename: string) => ({ filename, fileSize: BigInt(1), creationTime: new Date(), lastWriteTime: new Date(), changeTime: new Date(), type: "File" as const });
  const pages = [[item("first.pdf")], [item("second.pdf")]];
  const entries = await readAllSmbEntries({ async read() { if (pages.length) return pages.shift()!; throw { header: { status: 0x80000006 } }; } });
  expect(entries.map(entry => entry.filename)).toEqual(["first.pdf", "second.pdf"]);
  await expect(readAllSmbEntries({ async read() { return [item("loop.pdf")]; } })).rejects.toThrow("分页重复");
});
