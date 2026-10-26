const BASE = "";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...init,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const record = body as { error?: string; details?: unknown } | null;
    throw new ApiError(response.status, record?.error || `请求失败 (${response.status})`, record?.details);
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

export const api = {
  auth: {
    me: () => request<{ user: import("./types").User }>("/api/auth/me"),
    login: (account: string, password: string) =>
      request<{ user: import("./types").User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ account, password }),
      }),
    register: (input: { email: string; username: string; password: string; displayName?: string }) =>
      request<{ user: import("./types").User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    updateProfile: (input: { displayName?: string; password?: string }) =>
      request<{ user: import("./types").User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    users: () => request<{ users: Array<import("./types").User & { createdAt: string }> }>("/api/auth/users"),
  },
  sources: {
    list: () => request<{ sources: import("./types").Source[] }>("/api/sources"),
    types: () =>
      request<{ types: Array<{ type: string; label: string; description: string }> }>(
        "/api/source-types",
      ),
    get: (id: string) => request<{ source: import("./types").Source }>(`/api/sources/${id}`),
    create: (input: {
      name: string;
      type: string;
      config: Record<string, unknown>;
      enabled?: boolean;
      syncIntervalMinutes?: number;
    }) =>
      request<{ source: import("./types").Source }>("/api/sources", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      input: {
        name?: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
        syncIntervalMinutes?: number;
      },
    ) =>
      request<{ source: import("./types").Source }>(`/api/sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/sources/${id}`, { method: "DELETE" }),
    test: (input: { type: string; config: Record<string, unknown>; sourceId?: string }) =>
      request<{ ok: boolean; message: string; meta?: Record<string, unknown> }>("/api/sources/test", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    testExisting: (id: string) =>
      request<{ ok: boolean; message: string; meta?: Record<string, unknown> }>(
        `/api/sources/${id}/test`,
        { method: "POST" },
      ),
    sync: (id: string, force = false) =>
      request<{ job: { id: string; status: string; createdAt: string } }>(
        `/api/sources/${id}/sync`,
        { method: "POST", body: JSON.stringify({ force }) },
      ),
    cancel: (id: string) =>
      request<{ ok: boolean }>(`/api/sources/${id}/cancel`, { method: "POST" }),
    jobs: (id: string) =>
      request<{ jobs: import("./types").SyncJob[] }>(`/api/sources/${id}/jobs`),
  },
  jobs: {
    get: (id: string) => request<{ job: import("./types").SyncJob }>(`/api/sync-jobs/${id}`),
    list: () => request<{ jobs: import("./types").SyncJob[] }>("/api/sync-jobs"),
  },
  documents: {
    folders: (sourceId: string) => request<{ folders: string[] }>(`/api/documents/folders${qs({ sourceId })}`),
    list: (params: {
      q?: string;
      mode?: string;
      sourceId?: string;
      folder?: string;
      kind?: string;
      tag?: string;
      from?: string;
      to?: string;
      sort?: string;
      page?: number;
      pageSize?: number;
    }) => request<import("./types").SearchResponse>(`/api/documents${qs(params)}`),
    picker: (params: { q?: string; sourceId?: string; limit?: number }) =>
      request<{
        items: Array<{
          id: string;
          title: string;
          kind: string;
          sourceId: string;
          sourceName: string;
          date: string | null;
        }>;
      }>(`/api/documents/picker${qs(params)}`),
    get: (id: string) =>
      request<{ document: import("./types").DocumentDetail }>(`/api/documents/${id}`),
    remove: (id: string) =>
      request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
    fileUrl: (id: string) => `/api/documents/${id}/file`,
  },
  search: {
    query: (params: {
      q?: string;
      mode?: string;
      sourceId?: string;
      folder?: string;
      kind?: string;
      tag?: string;
      from?: string;
      to?: string;
      sort?: string;
      page?: number;
      pageSize?: number;
    }) => request<import("./types").SearchResponse>(`/api/search${qs(params)}`),
    suggest: (q: string) =>
      request<{ items: Array<{ id: string; title: string; kind: string; sourceName: string }> }>(
        `/api/search/suggest${qs({ q })}`,
      ),
  },
  tags: { list: () => request<{ tags: Array<{ tag: string; count: number }> }>("/api/tags") },
  stats: () => request<import("./types").Stats>("/api/stats"),
  providers: {
    list: () => request<{ providers: import("./types").Provider[] }>("/api/providers"),
    create: (input: {
      name: string;
      protocol: string;
      baseUrl: string;
      apiKey: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
    }) =>
      request<{ provider: import("./types").Provider }>("/api/providers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      input: {
        name?: string;
        protocol?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        temperature?: number;
        maxTokens?: number;
      },
    ) =>
      request<{ provider: import("./types").Provider }>(`/api/providers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" }),
    test: (id: string) =>
      request<{ ok: boolean; message: string }>(`/api/providers/${id}/test`, { method: "POST" }),
  },
  apiCredentials: {
    list: (page = 1, pageSize = 10) => request<{
      credentials: { items: import("./types").ApiCredentialMetadata[]; total: number; page: number; pageSize: number };
      availableScopes: import("./types").ApiScope[];
    }>(`/api/api-credentials${qs({ page, pageSize })}`),
    create: (input: { name: string; scopes: import("./types").ApiScope[]; expiresAt: string | null }) =>
      request<{ credential: { id: string; token: string; createdAt: string; expiresAt: string | null; scopes: import("./types").ApiScope[] }; warning: string }>("/api/api-credentials", {
        method: "POST", body: JSON.stringify(input),
      }),
    revoke: (id: string) => request<{ ok: boolean }>(`/api/api-credentials/${id}`, { method: "DELETE" }),
  },
  chat: {
    sessions: () => request<{ sessions: import("./types").ChatSession[] }>("/api/chat/sessions"),
    create: (input: {
      title?: string;
      providerId?: string | null;
      scope?: import("./types").ChatScope;
    }) =>
      request<{ session: import("./types").ChatSession }>("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (id: string) =>
      request<{
        session: import("./types").ChatSession;
        messages: import("./types").ChatMessage[];
      }>(`/api/chat/sessions/${id}`),
    update: (
      id: string,
      input: {
        title?: string;
        providerId?: string | null;
        scope?: import("./types").ChatScope;
      },
    ) =>
      request<{ session: import("./types").ChatSession }>(`/api/chat/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<{ ok: boolean }>(`/api/chat/sessions/${id}`, { method: "DELETE" }),
  },
};

export type StreamEvent =
  | { type: "start"; userMessage?: import("./types").ChatMessage; messageId?: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: import("./types").Citation[] }
  | { type: "done"; message: import("./types").ChatMessage }
  | { type: "error"; error: string };

/** Stream an assistant reply over SSE. Returns an abort function. */
export function streamChat(
  sessionId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        let message = `请求失败 (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {
          // ignore
        }
        onEvent({ type: "error", error: message });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminal = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLines = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());
          if (!dataLines.length) continue;
          const raw = dataLines.join("\n");
          try {
            const event = JSON.parse(raw) as StreamEvent;
            if (event.type === "done" || event.type === "error") terminal = true;
            onEvent(event);
          } catch {
            // ignore malformed frame
          }
        }
      }
      if (!terminal && !controller.signal.aborted) {
        onEvent({ type: "error", error: "连接已中断，回答可能不完整，请重试。" });
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        onEvent({ type: "error", error: (error as Error).message });
      }
    }
  })();
  return () => controller.abort();
}
