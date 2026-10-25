export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
}

export type SourceType = "local" | "smb" | "cubox" | "yuque";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown>;
  secretFields: string[];
  docCount: number;
  activeJob: {
    id: string;
    status: string;
    stats: SyncStats | null;
    startedAt: string | null;
  } | null;
}

export interface SyncStats {
  scanned: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: number;
  durationMs: number;
  complete: boolean;
  note?: string;
}

export interface SyncJob {
  id: string;
  sourceId?: string;
  sourceName?: string;
  status: "queued" | "running" | "success" | "error";
  stats: SyncStats | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface SearchItem {
  id: string;
  title: string;
  snippet: string;
  kind: string;
  sourceId: string;
  sourceName: string;
  author: string | null;
  url: string | null;
  mimeType: string | null;
  tags: string[];
  publishedAt: string | null;
  sourceCreatedAt: string | null;
  updatedAt: string;
  rank: number;
  highlights: string[];
}

export interface SearchResponse {
  items: SearchItem[];
  total: number;
  page: number;
  pageSize: number;
  terms: string[];
  facets?: { sources: Array<{ id: string; name: string; count: number }> };
}

export interface DocumentDetail {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  externalId: string;
  kind: string;
  title: string;
  description: string | null;
  author: string | null;
  url: string | null;
  mimeType: string | null;
  size: number | null;
  content: string | null;
  contentFormat: string;
  language: string | null;
  publishedAt: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  filePath: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  fileAvailable: boolean;
}

export interface Stats {
  stats: { documents: number; sources: number; tags: number; totalSize: number };
  bySource: Array<{
    id: string;
    name: string;
    type: SourceType;
    last_sync_at: string | null;
    last_sync_status: string | null;
    doc_count: number;
  }>;
  byKind: Array<{ kind: string; count: number }>;
  recent: Array<{
    id: string;
    title: string;
    kind: string;
    source_id: string;
    source_name: string;
    date: string;
  }>;
  activeSyncs: Array<{
    id: string;
    source_id: string;
    source_name: string;
    status: string;
    started_at: string | null;
  }>;
}

export interface Provider {
  id: string;
  name: string;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyMasked: string;
  createdAt: string;
}

export type ApiScope = "documents:read" | "sources:read" | "sources:write" | "sync:write" | "jobs:read";

export interface ApiCredentialMetadata {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "revoked";
}

export interface ChatScope {
  mode: "all" | "sources" | "documents" | "none";
  sourceIds: string[];
  documentIds: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  providerId: string | null;
  scope: ChatScope;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string | null;
}

export interface Citation {
  index: number;
  documentId: string;
  title: string;
  sourceName: string;
  url: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[] | null;
  createdAt: string;
}
