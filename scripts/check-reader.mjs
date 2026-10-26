import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanExcerpt, externalUrl, loadSavedViews, savedQuery, storeSavedViews, documentImageUrl, visibleFolders, readPreference, writePreference, folderStateKey, citationLink } from "../web/src/lib/library.ts";

const preview = cleanExcerpt("# 阅读资料\n[mp.weixin.qq.com](https://example.com/" + "x".repeat(500) + ")\n**可读的正文**", "阅读资料");
assert.equal(preview, "可读的正文");
assert.equal(cleanExcerpt("[原文](https://example.com/truncated"), "原文");
assert.equal(cleanExcerpt("?imageUrl=https%3A%2F%2Fexample.com%2Fimage.png) 这是真正正文"), "这是真正正文");
assert.equal(cleanExcerpt("内容".repeat(300)).length, 240);
assert.equal(externalUrl("javascript:alert(1)"), null);
assert.equal(externalUrl("data:text/html,hello"), null);
assert.equal(externalUrl("smb://nas/private"), null);
assert.equal(externalUrl("https://example.com/article"), "https://example.com/article");
assert.equal(savedQuery(new URLSearchParams("q=知识&sourceId=s1&doc=secret&page=8&redirect=https://example.com")),
  new URLSearchParams({ q: "知识", sourceId: "s1" }).toString());
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
let changed = 0;
globalThis.window = { dispatchEvent: () => { changed++; } };
storeSavedViews("reader-one", [{ id: "v1", name: "专业资料", query: "sourceId=s1&doc=private" }]);
assert.equal(changed, 1);
assert.equal(loadSavedViews("reader-one")[0].query, "sourceId=s1");
assert.deepEqual(loadSavedViews("reader-two"), []);
values.set("kb:views:reader-one", "invalid JSON");
assert.deepEqual(loadSavedViews("reader-one"), []);
values.set("kb:views:reader-one", JSON.stringify([{ id: "bad", name: 3, query: "q=x" }]));
assert.deepEqual(loadSavedViews("reader-one"), []);
delete globalThis.localStorage;
delete globalThis.window;
const aiAccess = fs.readFileSync(new URL("../web/src/pages/AiAccessPage.tsx", import.meta.url), "utf8");
assert.equal(/localStorage|sessionStorage/.test(aiAccess), false);
assert.match(aiAccess, /setCreated\(null\)/);
assert.match(aiAccess, /无法再次查看/);
console.log("Reader checks passed: readable previews, safe links, saved filters and user isolation.");

const localDoc = { id: "d1", sourceType: "local", url: null };
assert.equal(documentImageUrl("../图片/a b.png", localDoc), "/api/documents/d1/image?src=" + encodeURIComponent("../图片/a b.png"));
assert.equal(documentImageUrl("javascript:alert(1)", localDoc), undefined);
assert.equal(documentImageUrl("https://cdn.example/image.png", localDoc), "https://cdn.example/image.png");
assert.equal(documentImageUrl("../image.png", { ...localDoc, sourceType: "cubox", url: "https://example.com/a/page" }), "https://example.com/image.png");
assert.equal(savedQuery(new URLSearchParams("sourceId=s&folder=a%2Fb")), "sourceId=s&folder=a%2Fb");

const folders = ["a", "a/b", "a/b/c", "a/d", "ab", "ab/e"];
assert.deepEqual(visibleFolders(folders, new Set(["a"])).map(row => row.path), ["a", "ab", "ab/e"]);
assert.deepEqual(visibleFolders(folders, new Set(["a/b"])).map(row => row.path), ["a", "a/b", "a/d", "ab", "ab/e"]);
assert.deepEqual(visibleFolders(folders, new Set(folders)).map(row => row.path), ["a", "ab"]);
assert.deepEqual(visibleFolders(folders, new Set()).map(row => row.path), folders);
assert.deepEqual(visibleFolders(folders, new Set())[1], { path: "a/b", hasChildren: true, depth: 1 });
assert.equal(visibleFolders(folders, new Set())[2].hasChildren, false);
assert.deepEqual(visibleFolders([], new Set()), []);

assert.equal(visibleFolders(["ab", "abc"], new Set())[0].hasChildren, false);

const prefs = new Map();
globalThis.localStorage = { getItem: key => prefs.get(key) ?? null, setItem: (key, value) => prefs.set(key, value) };
writePreference(folderStateKey("one", "s"), { paths: ["a"], all: false });
assert.deepEqual(readPreference(folderStateKey("one", "s"), {}), { paths: ["a"], all: false });
assert.deepEqual(readPreference(folderStateKey("two", "s"), {}), {});
globalThis.localStorage = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("full"); } };
assert.deepEqual(readPreference("x", {}), {});
assert.doesNotThrow(() => writePreference("x", {}));
delete globalThis.localStorage;
const { documentOutline, passageOffset } = await import("../web/src/lib/reading.ts");
const markdown = "# 标题\n正文\n```md\n## 代码里的标题\n```\n## 正文小节\n片段定位";
assert.deepEqual(documentOutline(markdown).map(item => item.title), ["标题", "正文小节"]);
assert.equal(markdown.slice(documentOutline(markdown)[1].offset).startsWith("## 正文小节"), true);
assert.equal(passageOffset(markdown, "片段定位"), markdown.indexOf("片段定位"));
assert.equal(passageOffset(markdown, "不存在"), -1);
assert.equal(citationLink({ documentId: "d", excerpt: "引用正文" }), "/library?doc=d&passage=" + encodeURIComponent("引用正文"));

const originalFetch = globalThis.fetch;
let folderRequest;
globalThis.fetch = async url => { folderRequest = url; return new Response(JSON.stringify({ folders: [], items: [], total: 0 })); };
const { api } = await import("../web/src/lib/api.ts");
await api.documents.folders("source", "");
assert.equal(new URL("http://test" + folderRequest).searchParams.has("parent"), true);
assert.equal(new URL("http://test" + folderRequest).searchParams.get("parent"), "");
globalThis.fetch = originalFetch;
