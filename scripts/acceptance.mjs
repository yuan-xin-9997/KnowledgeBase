#!/usr/bin/env node
/**
 * 知屿 KnowledgeBase 验收脚本（真实 API，不使用假数据）。
 *
 * 必需环境变量：
 *   CUBOX_API_LINK    Cubox API 扩展链接（https://cubox.pro/c/api/save/xxxx）
 *   AI_BASE_URL       模型服务 base URL（如 https://api.deepseek.com/anthropic）
 *   AI_API_KEY        模型 API Key
 *   AI_MODEL          模型 ID（如 deepseek-chat）
 *   AI_PROTOCOL       openai | anthropic（默认 anthropic）
 *
 * 可选：
 *   KB_BASE_URL       默认 http://127.0.0.1:36080
 *   KB_ACCOUNT        默认 admin@local.test
 *   KB_PASSWORD       必填，验收账号密码（新环境首次运行时注册）
 *   KB_LOCAL_PATH     默认 NAS 专业资料 UNC 路径
 *   KB_LOCAL_MAX      默认 12（首次验收只取少量文件，避免同步过久）
 *   KB_SMB_HOST       设置后使用 SMB 代替本地目录（部署服务器验收）
 *   KB_SMB_SHARE      SMB 共享名
 *   KB_SMB_USERNAME   SMB 用户名
 *   KB_SMB_PASSWORD   SMB 密码
 *   KB_SMB_PATH       共享下的专业资料目录
 *   KB_SOURCE_NAME    专业资料来源名称（重跑时复用已有来源）
 *   KB_CUBOX_NAME     Cubox 来源名称（重跑时复用已有来源）
 *
 * 运行：
 *   node scripts/acceptance.mjs
 */
import fs from "node:fs";
import path from "node:path";

const base = (process.env.KB_BASE_URL || "http://127.0.0.1:36080").replace(/\/$/, "");
const account = process.env.KB_ACCOUNT || "admin@local.test";
const password = process.env.KB_PASSWORD || "";
const localPath =
  process.env.KB_LOCAL_PATH ||
  "\\\\192.168.0.100\\personal_folder\\Z_Backup\\雷神笔记本E盘同步到NAS的数据\\100-major-专业-pro";
const localMax = Number(process.env.KB_LOCAL_MAX || 12);
const cuboxLink = process.env.CUBOX_API_LINK || "";
const ai = {
  baseUrl: process.env.AI_BASE_URL || "",
  apiKey: process.env.AI_API_KEY || "",
  model: process.env.AI_MODEL || "",
  protocol: process.env.AI_PROTOCOL || "anthropic",
};

let cookie = "";
const steps = [];
const artifacts = { startedAt: new Date().toISOString(), base, steps: [], sources: {}, documents: [], chat: null };

function log(message) {
  console.log(`\n[acceptance] ${message}`);
}

function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  artifacts.steps.push({ name, ok, detail, at: new Date().toISOString() });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(method, pathname, body, extraHeaders = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length) {
    cookie = setCookies.map((item) => item.split(";")[0]).join("; ");
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && payload.error ? payload.error : text;
    throw new Error(`${method} ${pathname} -> HTTP ${response.status}: ${message}`);
  }
  return payload;
}

async function ensureAuth() {
  try {
    const me = await request("GET", "/api/auth/me");
    record("登录", true, me.user?.username);
    return me.user;
  } catch {
    // not logged in
  }
  try {
    const result = await request("POST", "/api/auth/login", { account, password });
    record("登录", true, result.user?.username);
    return result.user;
  } catch {
    const result = await request("POST", "/api/auth/register", {
      email: account.includes("@") ? account : `${account}@local.test`,
      username: account.includes("@") ? account.split("@")[0] : account,
      password,
      displayName: "验收管理员",
    });
    record("注册并登录（首个账号为管理员）", true, result.user?.username);
    return result.user;
  }
}

async function findSource(name) {
  const result = await request("GET", "/api/sources");
  return (result.sources || []).find((source) => source.name === name) || null;
}

async function createOrUpdateSource(name, type, config) {
  const existing = await findSource(name);
  if (existing) {
    const result = await request("PATCH", `/api/sources/${existing.id}`, {
      name,
      config,
      enabled: true,
    });
    record(`复用来源「${name}」`, true, existing.id);
    return result.source;
  }
  const result = await request("POST", "/api/sources", {
    name,
    type,
    config,
    enabled: true,
    syncIntervalMinutes: 0,
  });
  record(`创建来源「${name}」`, true, result.source.id);
  return result.source;
}

async function waitJob(jobId, timeoutMs = 15 * 60_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const result = await request("GET", `/api/sync-jobs/${jobId}`);
    const job = result.job;
    const stats = job.stats || {};
    const line = `${job.status} scanned=${stats.scanned ?? 0} created=${stats.created ?? 0} updated=${stats.updated ?? 0} skipped=${stats.skipped ?? 0} errors=${stats.errors ?? 0}`;
    if (line !== last) {
      console.log(`    · ${line}`);
      last = line;
    }
    if (job.status === "success") return job;
    if (job.status === "error") throw new Error(`同步失败：${job.error}`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`同步超时（job ${jobId}）`);
}

async function syncSource(source, force = false) {
  const result = await request("POST", `/api/sources/${source.id}/sync`, { force });
  return waitJob(result.job.id);
}

async function listDocs(sourceId, query) {
  const params = new URLSearchParams({ sourceId, pageSize: "20", sort: "newest" });
  if (query) params.set("q", query);
  return request("GET", `/api/documents?${params}`);
}

function titleQuery(title) {
  const cjk = (title.match(/[\u4e00-\u9fff]{2,}/g) || []).sort((a, b) => b.length - a.length)[0];
  if (cjk) return cjk.slice(0, 6);
  return title.split(/[\s._-]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] || title;
}

async function checkSearch(label, query, sourceId) {
  const result = await request(
    "GET",
    `/api/search?${new URLSearchParams({ q: query, sourceId, pageSize: "5" })}`,
  );
  if (!result.items?.length) throw new Error(`${label} 检索无结果：${query}`);
  record(`${label} 全文检索`, true, `“${query}” → ${result.total} 条，首条「${result.items[0].title}」`);
  return result.items[0];
}

async function readableDocument(items, label) {
  for (const item of items) {
    const { document } = await request("GET", `/api/documents/${item.id}`);
    if ((document.content || "").trim().length >= 80) {
      record(`${label} 正文抽取`, true, `${document.title}：${document.content.length} 字符`);
      const candidates = document.content.match(/[\u4e00-\u9fff]{3,10}|[A-Za-z]{5,20}/g) || [];
      const term = candidates.find((value) => !document.title.includes(value)) || candidates[0];
      if (!term) throw new Error(`${label} 正文没有可检索词`);
      const result = await request("GET", `/api/search?${new URLSearchParams({
        q: term, sourceId: document.sourceId, mode: "content", pageSize: "100",
      })}`);
      record(`${label} 正文词检索`, result.items.some((entry) => entry.id === document.id), `“${term}”`);
      return document;
    }
  }
  throw new Error(`${label} 没有成功抽取正文，不能仅以标题命中作为验收通过`);
}

async function checkChat(provider, title, scope, question, allowedIds, expectReferences = true) {
  const { session } = await request("POST", "/api/chat/sessions", {
    title: `验收：${title}`, providerId: provider.id, scope,
  });
  const chat = await streamChat(session.id, question);
  const usedIndices = new Set([...chat.answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  chat.usedCitations = chat.citations.filter((cite) => usedIndices.has(cite.index));
  record(`${title} AI 流式回答`, chat.answer.trim().length > 10 && Boolean(chat.done), `${chat.answer.slice(0, 100)}…`);
  record(`${title} 引用范围`, expectReferences
    ? chat.usedCitations.length > 0 && chat.citations.every((cite) => allowedIds.has(cite.documentId))
    : chat.citations.length === 0, `${chat.citations.length} 条引用`);
  const history = await request("GET", `/api/chat/sessions/${session.id}`);
  record(`${title} 历史持久化`, history.messages?.some((message) => message.role === "assistant" && message.content === chat.answer));
  artifacts.chats ||= [];
  artifacts.chats.push({ title, sessionId: session.id, scope, answer: chat.answer, citations: chat.citations, usedCitations: chat.usedCitations });
  return chat;
}

async function streamChat(sessionId, content) {
  const response = await fetch(`${base}/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ content }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`聊天接口失败 HTTP ${response.status}: ${text}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let done = null;
  let citations = [];
  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.type === "delta") answer += event.text || "";
      if (event.type === "citations") citations = event.citations || [];
      if (event.type === "done") done = event.message;
      if (event.type === "error") throw new Error(`模型返回错误：${event.error}`);
    }
  }
  return { answer: answer || done?.content || "", done, citations };
}

async function main() {
  if (!password) throw new Error("请设置 KB_PASSWORD，不使用公共默认密码");
  log(`目标服务：${base}`);
  const user = await ensureAuth();
  artifacts.user = user;

  // 1. NAS 专业资料
  log("步骤 1/4：接入专业资料目录");
  const smb = Boolean(process.env.KB_SMB_HOST);
  const localSource = await createOrUpdateSource(process.env.KB_SOURCE_NAME || (smb ? "NAS 专业资料 SMB（验收）" : "NAS 专业资料（验收）"), smb ? "smb" : "local", {
    ...(smb ? {
      host: process.env.KB_SMB_HOST,
      share: process.env.KB_SMB_SHARE,
      username: process.env.KB_SMB_USERNAME,
      password: process.env.KB_SMB_PASSWORD,
      basePath: process.env.KB_SMB_PATH || "",
    } : { path: localPath }),
    includeExtensions: ["pdf", "docx", "doc", "pptx", "xlsx", "txt", "md", "html"],
    maxFileSizeMb: 80,
    maxFiles: localMax,
    followSymlinks: false,
  });
  const testLocal = await request("POST", `/api/sources/${localSource.id}/test`);
  record("专业资料目录连接测试", Boolean(testLocal.ok), testLocal.message);
  if (!testLocal.ok) throw new Error(`目录不可访问：${testLocal.message}`);

  const localJob = await syncSource(localSource);
  record(
    "专业资料同步",
    localJob.stats?.processed > 0 && localJob.stats?.errors === 0,
    `新增 ${localJob.stats?.created || 0}，错误 ${localJob.stats?.errors || 0}，用时 ${Math.round(
      (localJob.stats?.durationMs || 0) / 1000,
    )}s`,
  );
  const localDocs = await listDocs(localSource.id);
  if (!localDocs.items?.length) throw new Error("专业资料同步后没有文档");
  artifacts.sources.local = {
    id: localSource.id,
    count: localDocs.total,
    sample: localDocs.items.slice(0, 5).map((item) => item.title),
  };
  const localDoc = await readableDocument(localDocs.items, "专业资料");
  artifacts.documents.push({ source: "local", id: localDoc.id, title: localDoc.title });
  await checkSearch("专业资料", titleQuery(localDoc.title), localSource.id);
  const attachment = await request("GET", `/api/search?${new URLSearchParams({ q: titleQuery(localDoc.title), sourceId: localSource.id, mode: "attachment" })}`);
  record("附件检索", attachment.items.some((item) => item.id === localDoc.id));
  const file = await fetch(`${base}/api/documents/${localDoc.id}/file`, { headers: { Cookie: cookie, Range: "bytes=0-15" } });
  record("原始附件读取", file.status === 206 && (await file.arrayBuffer()).byteLength === 16);
  const excluded = await request("GET", `/api/search?${new URLSearchParams({ sourceId: localSource.id, from: "2099-01-01" })}`);
  record("时间筛选", excluded.total === 0);

  // 2. Cubox
  log("步骤 2/4：接入 Cubox");
  if (!cuboxLink) throw new Error("缺少 CUBOX_API_LINK 环境变量");
  const cuboxSource = await createOrUpdateSource(process.env.KB_CUBOX_NAME || "Cubox（验收）", "cubox", {
    apiLink: cuboxLink,
    limit: 12,
    sinceDays: 0,
    includeArchived: false,
    fetchDetails: true,
  });
  const testCubox = await request("POST", `/api/sources/${cuboxSource.id}/test`);
  record("Cubox 连接测试", Boolean(testCubox.ok), testCubox.message);
  if (!testCubox.ok) throw new Error(`Cubox 连接失败：${testCubox.message}`);

  const cuboxJob = await syncSource(cuboxSource);
  record(
    "Cubox 同步",
    cuboxJob.stats?.processed > 0 && cuboxJob.stats?.errors === 0,
    `新增 ${cuboxJob.stats?.created || 0}，错误 ${cuboxJob.stats?.errors || 0}`,
  );
  const cuboxDocs = await listDocs(cuboxSource.id);
  if (!cuboxDocs.items?.length) throw new Error("Cubox 同步后没有文档");
  artifacts.sources.cubox = {
    id: cuboxSource.id,
    count: cuboxDocs.total,
    sample: cuboxDocs.items.slice(0, 5).map((item) => item.title),
  };
  const cuboxDoc = await readableDocument(cuboxDocs.items, "Cubox");
  artifacts.documents.push({ source: "cubox", id: cuboxDoc.id, title: cuboxDoc.title });
  await checkSearch("Cubox", titleQuery(cuboxDoc.title), cuboxSource.id);
  const publicSources = await request("GET", "/api/sources");
  const cuboxToken = cuboxLink.split("/").pop();
  record("来源密钥不回显", !JSON.stringify(publicSources).includes(cuboxToken));

  // 3. 模型
  log("步骤 3/4：配置并测试大模型");
  if (!ai.baseUrl || !ai.apiKey || !ai.model) throw new Error("缺少 AI_BASE_URL / AI_API_KEY / AI_MODEL");
  const providers = await request("GET", "/api/providers");
  let provider = (providers.providers || []).find(
    (item) => item.baseUrl === ai.baseUrl && item.model === ai.model,
  );
  if (!provider) {
    const created = await request("POST", "/api/providers", {
      name: `验收模型 ${ai.model}`,
      protocol: ai.protocol,
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
      model: ai.model,
      temperature: 0.3,
      maxTokens: 8192,
    });
    provider = created.provider;
  }
  await request("PATCH", `/api/providers/${provider.id}`, { apiKey: ai.apiKey, maxTokens: 8192 });
  const tested = await request("POST", `/api/providers/${provider.id}/test`);
  record("模型连接测试", Boolean(tested.ok), tested.message);
  if (!tested.ok) throw new Error(`模型不可用：${tested.message}`);

  // 4. 带知识范围的 AI 会话
  log("步骤 4/4：AI 的单篇文档、来源、多来源、全部与无来源范围");
  const localIds = new Set(localDocs.items.map((item) => item.id));
  const cuboxIds = new Set(cuboxDocs.items.map((item) => item.id));
  const allIds = new Set([...localIds, ...cuboxIds]);
  const summarize = (title) => `请用两句话总结《${title}》的核心内容，并用 [1] 标注引用。`;
  await checkChat(provider, "专业资料单篇", { mode: "documents", documentIds: [localDoc.id] }, summarize(localDoc.title), new Set([localDoc.id]));
  await checkChat(provider, "Cubox 单篇", { mode: "documents", documentIds: [cuboxDoc.id] }, summarize(cuboxDoc.title), new Set([cuboxDoc.id]));
  await checkChat(provider, "单个来源", { mode: "sources", sourceIds: [cuboxSource.id] }, summarize(cuboxDoc.title), cuboxIds);
  const multi = await checkChat(provider, "多个来源", { mode: "sources", sourceIds: [localSource.id, cuboxSource.id] }, `请分别用一句话介绍《${localDoc.title}》和《${cuboxDoc.title}》，标注对应引用。`, allIds);
  record("多来源分别引用", multi.usedCitations.some((cite) => localIds.has(cite.documentId)) && multi.usedCitations.some((cite) => cuboxIds.has(cite.documentId)));
  await checkChat(provider, "全部知识库", { mode: "all" }, summarize(cuboxDoc.title), allIds);
  await checkChat(provider, "无知识来源", { mode: "none" }, "请用一句话解释什么是知识库。", new Set(), false);
  artifacts.finishedAt = new Date().toISOString();
  artifacts.ok = steps.every((step) => step.ok);

  const outDir = path.join(process.cwd(), "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `acceptance-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(artifacts, null, 2), "utf8");
  log(`验收产物：${outFile}`);
  log(artifacts.ok ? "验收通过 ✅" : "验收未完全通过 ❌");
  if (!artifacts.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n[acceptance] 失败：${error.message}`);
  artifacts.finishedAt = new Date().toISOString();
  artifacts.ok = false;
  artifacts.error = error.message;
  try {
    const outDir = path.join(process.cwd(), "artifacts");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `acceptance-failed-${Date.now()}.json`),
      JSON.stringify(artifacts, null, 2),
      "utf8",
    );
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
