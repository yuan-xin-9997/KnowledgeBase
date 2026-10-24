import { afterEach, expect, it, vi } from "vitest";
import cubox, { formatCuboxTime } from "../cubox.js";
import yuque from "../yuque.js";
import { extractText, htmlToText } from "../extract.js";
import { parseSmbConfig } from "../smb.js";
import type { Connector, SyncContext } from "../types.js";

const ctx: SyncContext = { sourceId: "s", userId: "u", since: null, signal: new AbortController().signal, onProgress() {}, log() {} };
afterEach(() => vi.unstubAllGlobals());
async function scan(connector: Connector, config: Record<string, unknown>) {
  const iterator = connector.scan(config, ctx);
  const items = [];
  while (true) { const next = await iterator.next(); if (next.done) return { items, summary: next.value }; items.push({ item: next.value, loaded: await next.value.load() }); }
}
const json = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { headers: { "Content-Type": "application/json" } });

it("loads Cubox正文、高亮、摘要 and marks a capped/time-window scan incomplete", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/detail") ? json({ id: "1", title: "专业收藏", content: "文章正文", annotations: [{ text: "重要段落", note: "重点" }], insight: { summary: "摘要" } }) : json([{ id: "1", title: "专业收藏" }])));
  const capped = await scan(cubox, { token: "dummy", limit: 1 });
  expect(capped.summary.complete).toBe(false);
  expect(capped.items[0].loaded.content).toContain("文章正文");
  expect(capped.items[0].loaded.content).toContain("重要段落");
  expect(capped.items[0].loaded.content).toContain("摘要");
  const window = await scan(cubox, { token: "dummy", limit: 10, sinceDays: 7 });
  expect(window.summary.complete).toBe(false);
  expect(formatCuboxTime(new Date("2026-10-24T00:00:00Z"))).toBe("2026-10-24T08:00:00.000+0800");
});

it("rejects malformed Cubox responses instead of treating them as an empty collection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ unexpected: true })));
  await expect(scan(cubox, { token: "dummy" })).rejects.toThrow("列表格式无效");
});

it("loads Yuque repositories and document markdown with its token header", async () => {
  const mocked = vi.fn(async (url: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>)["X-Auth-Token"]).toBe("dummy");
    if (url.includes("/docs/3")) return json({ id: 3, title: "语雀文章", body: "# 知识正文" });
    if (url.includes("/docs?")) return json([{ id: 3, slug: "article", title: "语雀文章" }]);
    if (url.includes("/repos/")) return json({ id: 2, namespace: "user/repo", name: "知识库" });
    throw new Error("unexpected request");
  });
  vi.stubGlobal("fetch", mocked);
  const result = await scan(yuque, { token: "dummy", repoIds: ["user/repo"] });
  expect(result.summary.complete).toBe(true);
  expect(result.items[0].loaded.content).toBe("# 知识正文");
  expect(result.items[0].item.externalId).toBe("2/3");
});

it("extracts searchable text and preserves local/SMB exclusion options", async () => {
  const result = await extractText({ buffer: Buffer.from("# 专业知识\n全文检索"), extension: "md" });
  expect(result.content).toContain("全文检索");
  expect(htmlToText("<title>T</title><script>secret</script><p>正文</p>").text).toContain("正文");
  expect(htmlToText("<script>secret</script><p>正文</p>").text).not.toContain("secret");
  expect(parseSmbConfig({ host: "nas", share: "files", username: "user", excludeGlobs: "*.tmp,**/cache/**" }).excludeGlobs).toEqual(["*.tmp", "**/cache/**"]);
});
