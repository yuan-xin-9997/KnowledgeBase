export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface ApiCredential {
  id: string;
  userId: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
}

export type SourceType = "local" | "smb" | "cubox" | "yuque";

export interface SourceRow {
  id: string;
  user_id: string;
  name: string;
  type: SourceType;
  config_enc: string;
  enabled: number;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  source_id: string;
  external_id: string;
  kind: string;
  title: string;
  description: string | null;
  author: string | null;
  url: string | null;
  mime_type: string | null;
  size: number | null;
  content: string | null;
  content_format: string | null;
  language: string | null;
  published_at: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  file_path: string | null;
  file_hash: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SyncJobRow {
  id: string;
  source_id: string;
  user_id: string;
  status: "queued" | "running" | "success" | "error";
  stats: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AiProviderRow {
  id: string;
  user_id: string;
  name: string;
  protocol: "openai" | "anthropic";
  base_url: string;
  api_key_enc: string;
  model: string;
  temperature: number;
  max_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  provider_id: string | null;
  scope: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  citations: string | null;
  created_at: string;
}

export interface SearchResult {
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

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    apiCredential: ApiCredential | null;
  }
}
