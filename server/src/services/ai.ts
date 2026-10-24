import type { AiProviderRow } from "../types.js";
import { db, newId, nowIso } from "../db.js";
import { decryptJson, encryptJson, maskSecret } from "../crypto.js";
import { badRequest, notFound } from "../util.js";

export type AiProtocol = "openai" | "anthropic";

export interface PublicProvider {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyMasked: string;
  createdAt: string;
}

export interface ProviderInput {
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderPatch {
  name?: string;
  protocol?: AiProtocol;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Citation {
  index: number;
  documentId: string;
  title: string;
  sourceName: string;
  url: string | null;
}

/** Failure raised by the AI client. `aborted` means the caller cancelled the request. */
export class AiError extends Error {
  status?: number;
  aborted: boolean;

  constructor(message: string, status?: number, aborted = false) {
    super(message);
    this.name = "AiError";
    this.status = status;
    this.aborted = aborted;
  }
}

/* -------------------------------------------------------------------------- */
/* Provider storage                                                            */
/* -------------------------------------------------------------------------- */

export function providerApiKey(row: AiProviderRow): string {
  try {
    const value = decryptJson<string>(row.api_key_enc);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function publicProvider(row: AiProviderRow): PublicProvider {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    apiKeyMasked: maskSecret(providerApiKey(row)),
    createdAt: row.created_at,
  };
}

export function getProviderRow(userId: string, id: string): AiProviderRow {
  const row = db
    .prepare("SELECT * FROM ai_providers WHERE id = ? AND user_id = ?")
    .get(id, userId) as AiProviderRow | undefined;
  if (!row) notFound("模型配置不存在");
  return row;
}

export function getLatestProvider(userId: string): AiProviderRow | null {
  const row = db
    .prepare(
      "SELECT * FROM ai_providers WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(userId) as AiProviderRow | undefined;
  return row ?? null;
}

export function listProviders(userId: string): AiProviderRow[] {
  return db
    .prepare("SELECT * FROM ai_providers WHERE user_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(userId) as AiProviderRow[];
}

export function createProvider(userId: string, input: ProviderInput): AiProviderRow {
  const id = newId("prov");
  const now = nowIso();
  db.prepare(
    `INSERT INTO ai_providers(id, user_id, name, protocol, base_url, api_key_enc, model,
       temperature, max_tokens, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    input.name.trim(),
    input.protocol,
    input.baseUrl.trim(),
    encryptJson(input.apiKey),
    input.model.trim(),
    clampNumber(input.temperature ?? 0.3, 0, 2),
    Math.round(clampNumber(input.maxTokens ?? 4096, 1, 32768)),
    now,
    now,
  );
  return getProviderRow(userId, id);
}

export function updateProvider(
  userId: string,
  id: string,
  patch: ProviderPatch,
): AiProviderRow {
  const row = getProviderRow(userId, id);
  // An empty apiKey in the edit form keeps the previously stored secret.
  const apiKey = patch.apiKey && patch.apiKey.trim() ? patch.apiKey.trim() : providerApiKey(row);
  if (!apiKey) badRequest("请输入 API Key");
  db.prepare(
    `UPDATE ai_providers SET name = ?, protocol = ?, base_url = ?, api_key_enc = ?, model = ?,
       temperature = ?, max_tokens = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  ).run(
    patch.name?.trim() || row.name,
    patch.protocol ?? row.protocol,
    patch.baseUrl?.trim() || row.base_url,
    encryptJson(apiKey),
    patch.model?.trim() || row.model,
    patch.temperature === undefined ? row.temperature : clampNumber(patch.temperature, 0, 2),
    patch.maxTokens === undefined
      ? row.max_tokens
      : Math.round(clampNumber(patch.maxTokens, 1, 32768)),
    nowIso(),
    id,
    userId,
  );
  return getProviderRow(userId, id);
}

export function deleteProvider(userId: string, id: string): void {
  getProviderRow(userId, id);
  const run = db.transaction(() => {
    // Detach sessions so they fall back to the user's newest provider.
    db.prepare("UPDATE chat_sessions SET provider_id = NULL WHERE provider_id = ? AND user_id = ?").run(
      id,
      userId,
    );
    db.prepare("DELETE FROM ai_providers WHERE id = ? AND user_id = ?").run(id, userId);
  });
  run();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* Endpoint resolution / protocol adaptation                                   */
/* -------------------------------------------------------------------------- */

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function resolveOpenAiEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/^https:\/\/api\.openai\.com$/i.test(base)) return `${base}/v1/chat/completions`;
  return `${base}/chat/completions`;
}

export function resolveAnthropicEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl);
  if (/\/messages$/i.test(base)) return base;
  // DeepSeek / MiniMax / 智谱 compatible endpoints look like https://host/anthropic
  if (/\/anthropic$/i.test(base)) return `${base}/v1/messages`;
  if (/^https:\/\/api\.anthropic\.com$/i.test(base)) return `${base}/v1/messages`;
  if (/\/v1$/i.test(base)) return `${base}/messages`;
  return `${base}/v1/messages`;
}

interface ProtocolRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface BuildOptions {
  provider: AiProviderRow;
  system?: string;
  messages: ChatTurn[];
  maxTokens: number;
  temperature: number;
  stream: boolean;
}

function nonEmpty(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildOpenAiMessages(system: string, turns: ChatTurn[]): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  for (const turn of turns) {
    const content = nonEmpty(turn.content);
    if (!content) continue;
    if (turn.role === "system") {
      // Merge extra system turns into a single leading system message.
      if (messages[0]?.role === "system") messages[0].content += `\n\n${content}`;
      else messages.unshift({ role: "system", content });
      continue;
    }
    messages.push({ role: turn.role, content });
  }
  if (!messages.some((message) => message.role !== "system")) {
    messages.push({ role: "user", content: "你好" });
  }
  return messages;
}

function buildAnthropicMessages(
  turns: ChatTurn[],
): { system: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of turns) {
    const content = nonEmpty(turn.content);
    if (!content) continue;
    if (turn.role === "system") {
      systemParts.push(content);
      continue;
    }
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role) last.content += `\n\n${content}`;
    else messages.push({ role: turn.role, content });
  }
  if (messages.length === 0) messages.push({ role: "user", content: "你好" });
  // Anthropic expects the conversation to start with a user turn.
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: "继续。" });
  return { system: systemParts.join("\n\n"), messages };
}

function buildProtocolRequest(options: BuildOptions): ProtocolRequest {
  const provider = options.provider;
  const apiKey = providerApiKey(provider);
  if (!apiKey) throw new AiError("该模型配置缺少 API Key，请重新填写", 400);
  const temperature = clampNumber(options.temperature, 0, 2);
  const maxTokens = Math.round(clampNumber(options.maxTokens, 1, 32768));

  if (provider.protocol === "anthropic") {
    const converted = buildAnthropicMessages([
      ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
      ...options.messages,
    ]);
    const body: Record<string, unknown> = {
      model: provider.model,
      messages: converted.messages,
      max_tokens: maxTokens,
      temperature: Math.min(temperature, 1),
      stream: options.stream,
    };
    if (converted.system) body.system = converted.system;
    return {
      url: resolveAnthropicEndpoint(provider.base_url),
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
    };
  }

  return {
    url: resolveOpenAiEndpoint(provider.base_url),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: {
      model: provider.model,
      messages: buildOpenAiMessages(options.system ?? "", options.messages),
      temperature,
      max_tokens: maxTokens,
      stream: options.stream,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP + SSE plumbing                                                         */
/* -------------------------------------------------------------------------- */

function collapse(text: string, max = 200): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractDetail(payload: unknown): string {
  if (!payload) return "";
  if (typeof payload === "string") return collapse(payload);
  if (typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return collapse(error);
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string") return collapse(nested.message);
    if (typeof nested.type === "string") return collapse(nested.type);
  }
  for (const key of ["message", "msg", "detail", "error_msg", "status_msg"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return collapse(value);
  }
  const base = record.base_resp;
  if (base && typeof base === "object") {
    const baseRecord = base as Record<string, unknown>;
    if (typeof baseRecord.status_msg === "string" && baseRecord.status_msg.trim()) {
      return collapse(baseRecord.status_msg);
    }
  }
  return "";
}

function friendlyStatus(status: number): string {
  if (status === 400) return "模型拒绝了请求（参数不受支持）";
  if (status === 401) return "API Key 无效或已过期";
  if (status === 402) return "模型账户余额不足，请充值后重试";
  if (status === 403) return "API Key 没有访问该模型的权限";
  if (status === 404) return "接口地址不存在，请检查 Base URL";
  if (status === 413) return "请求内容过长，请缩短对话或减少资料";
  if (status === 429) return "请求过于频繁或额度不足，请稍后再试";
  if (status >= 500) return `模型服务异常（HTTP ${status}）`;
  return `模型请求失败（HTTP ${status}）`;
}

async function upstreamError(response: Response): Promise<AiError> {
  let detail = "";
  try {
    const text = await response.text();
    detail = extractDetail(safeParseJson(text)) || collapse(text);
  } catch {
    // Ignore body read failures; the status code is enough.
  }
  const message = detail ? `${friendlyStatus(response.status)}：${detail}` : friendlyStatus(response.status);
  return new AiError(message, response.status);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "AbortError" ||
      (error as { code?: string }).code === "ABORT_ERR")
  );
}

interface TimeoutSignal {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

function createTimeoutSignal(timeoutMs: number, external?: AbortSignal): TimeoutSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  const forward = (): void => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", forward);
    },
  };
}

function normalizeError(error: unknown, timedOut: boolean, timeoutMs: number): AiError {
  if (error instanceof AiError) return error;
  if (timedOut) {
    return new AiError(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒），请稍后重试或检查接口地址`);
  }
  if (isAbortError(error)) return new AiError("请求已取消", undefined, true);
  if (error instanceof TypeError) {
    return new AiError("无法连接到模型服务，请检查 Base URL 与网络连接");
  }
  return new AiError(error instanceof Error ? error.message : "模型调用失败");
}

export interface SseFrame {
  event: string | null;
  data: string;
}

function findFrameSeparator(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseSseFrame(raw: string): SseFrame | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

/** Parse SSE frames from a byte stream, keeping half lines buffered across chunks. */
async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const separator = findFrameSeparator(buffer);
        if (!separator) break;
        const raw = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const frame = parseSseFrame(raw);
        if (frame) yield frame;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      if (frame) yield frame;
    }
  } finally {
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const part of content) {
    if (typeof part === "string") text += part;
    else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      text += (part as { text: string }).text;
    }
  }
  return text;
}

function extractCompletionText(payload: unknown, protocol: AiProtocol): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (protocol === "anthropic") {
    const direct = textFromContent(record.content);
    if (direct) return direct;
    return textFromContent(record.completion);
  }
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message) {
      const text = textFromContent(message.content);
      if (text) return text;
    }
    const text = textFromContent(choice.text);
    if (text) return text;
  }
  // Some compatible gateways return Anthropic-shaped payloads on the OpenAI path.
  return textFromContent(record.content);
}

function streamError(payload: Record<string, unknown>): AiError {
  const detail =
    extractDetail(payload.error) ||
    extractDetail(payload) ||
    "模型服务返回了错误";
  return new AiError(detail);
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: unknown };
    text?: string | null;
  }>;
  error?: unknown;
}

interface AnthropicChunk {
  type?: string;
  delta?: { text?: string | null };
  content_block?: { text?: string | null };
  error?: unknown;
}

interface DeltaResult {
  delta?: string;
  done?: boolean;
}

function parseOpenAiChunk(frame: SseFrame): DeltaResult {
  const raw = frame.data.trim();
  if (!raw) return {};
  if (raw === "[DONE]") return { done: true };
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const chunk = parsed as OpenAIChunk;
  if (chunk.error) throw streamError(chunk as Record<string, unknown>);
  const choice = chunk.choices?.[0];
  if (!choice) return {};
  const delta = choice.delta?.content ?? choice.text ?? choice.message?.content;
  const text = typeof delta === "string" ? delta : textFromContent(delta);
  return text ? { delta: text } : {};
}

function parseAnthropicChunk(frame: SseFrame): DeltaResult {
  const raw = frame.data.trim();
  if (!raw) return {};
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const chunk = parsed as AnthropicChunk;
  const type = chunk.type ?? frame.event;
  if (type === "error") throw streamError(chunk as Record<string, unknown>);
  if (type === "message_stop") return { done: true };
  if (type === "content_block_delta") {
    const text = chunk.delta?.text;
    return typeof text === "string" && text ? { delta: text } : {};
  }
  if (type === "content_block_start") {
    const text = chunk.content_block?.text;
    return typeof text === "string" && text ? { delta: text } : {};
  }
  return {};
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

export interface StreamChatOptions {
  provider: AiProviderRow;
  system?: string;
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  /** Defaults to 120s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}

/**
 * Stream an assistant reply. Returns the full accumulated text.
 * Throws AiError with a readable Chinese message on failure.
 */
export async function streamChat(options: StreamChatOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timeout = createTimeoutSignal(timeoutMs, options.signal);
  try {
    const prepared = buildProtocolRequest({
      provider: options.provider,
      system: options.system,
      messages: options.messages,
      maxTokens: options.maxTokens ?? options.provider.max_tokens,
      temperature: options.temperature ?? options.provider.temperature,
      stream: true,
    });
    const response = await fetch(prepared.url, {
      method: "POST",
      headers: prepared.headers,
      body: JSON.stringify(prepared.body),
      signal: timeout.signal,
    });
    if (!response.ok) throw await upstreamError(response);

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      // Gateway ignored stream:true and returned a regular completion.
      const text = await response.text();
      const payload = safeParseJson(text);
      if (payload && typeof payload === "object" && (payload as Record<string, unknown>).error) {
        throw streamError(payload as Record<string, unknown>);
      }
      const content = extractCompletionText(payload, options.provider.protocol);
      if (!content.trim()) throw new AiError("模型没有返回可用的回答内容");
      if (content.trim()) options.onDelta(content);
      return content;
    }
    if (!response.body) throw new AiError("模型服务返回了空响应");

    let content = "";
    for await (const frame of readSseFrames(response.body)) {
      if (timeout.signal.aborted) break;
      const result =
        options.provider.protocol === "anthropic"
          ? parseAnthropicChunk(frame)
          : parseOpenAiChunk(frame);
      if (result.done) break;
      if (result.delta) {
        content += result.delta;
        options.onDelta(result.delta);
      }
    }
    return content;
  } catch (error) {
    if (options.signal?.aborted) throw new AiError("请求已取消", undefined, true);
    throw normalizeError(error, timeout.timedOut(), timeoutMs);
  } finally {
    timeout.cleanup();
  }
}

export interface CompleteOptions {
  provider: AiProviderRow;
  system?: string;
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Non-streaming completion, used by the provider connection test. */
export async function completeOnce(options: CompleteOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const timeout = createTimeoutSignal(timeoutMs);
  try {
    const prepared = buildProtocolRequest({
      provider: options.provider,
      system: options.system,
      messages: options.messages,
      maxTokens: options.maxTokens ?? options.provider.max_tokens,
      temperature: options.temperature ?? options.provider.temperature,
      stream: false,
    });
    const response = await fetch(prepared.url, {
      method: "POST",
      headers: prepared.headers,
      body: JSON.stringify(prepared.body),
      signal: timeout.signal,
    });
    if (!response.ok) throw await upstreamError(response);
    const text = await response.text();
    const payload = safeParseJson(text);
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).error) {
      throw streamError(payload as Record<string, unknown>);
    }
    const content = payload ? extractCompletionText(payload, options.provider.protocol) : "";
    if (content.trim()) return content.trim();
    throw new AiError("模型没有返回内容");
  } catch (error) {
    throw normalizeError(error, timeout.timedOut(), timeoutMs);
  } finally {
    timeout.cleanup();
  }
}

export interface TestProviderResult {
  ok: boolean;
  message: string;
}

export async function testProviderConnection(row: AiProviderRow): Promise<TestProviderResult> {
  const started = Date.now();
  try {
    const text = await completeOnce({
      provider: row,
      messages: [{ role: "user", content: "只回复 OK，不需要推理或解释。" }],
      // Reasoning models may spend a small output budget before emitting visible text.
      maxTokens: 2048,
      temperature: 0,
      timeoutMs: 60_000,
    });
    const elapsed = Date.now() - started;
    const preview = collapse(text, 60);
    return {
      ok: true,
      message: `连接成功（${row.model}，${elapsed}ms）：${preview || "模型已响应"}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接测试失败";
    return { ok: false, message };
  }
}

/** Keep at most `limit` history turns and a rough character budget. */
export function trimHistory(turns: ChatTurn[], limit = 10, maxChars = 20_000): ChatTurn[] {
  const kept = turns.slice(-Math.max(1, limit));
  let total = 0;
  const result: ChatTurn[] = [];
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const turn = kept[i];
    const text = turn.content.replace(/\u0000/g, "").trim().slice(0, 6000);
    if (!text) continue;
    if (total + text.length > maxChars && result.length > 0) break;
    result.unshift({ role: turn.role, content: text });
    total += text.length;
  }
  return result;
}
