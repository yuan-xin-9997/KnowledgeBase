import type { SourceType } from "../types.js";

export interface TestResult {
  ok: boolean;
  message: string;
  meta?: Record<string, unknown>;
}

export interface SyncContext {
  sourceId: string;
  userId: string;
  since: string | null;
  signal: AbortSignal;
  onProgress: (progress: { processed: number; total?: number; current?: string }) => void;
  log: (message: string) => void;
}

export interface LoadedContent {
  title?: string;
  description?: string;
  author?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  content: string;
  contentFormat?: "text" | "markdown" | "html";
  publishedAt?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScanItem {
  externalId: string;
  kind: "file" | "article" | "note";
  title: string;
  description?: string | null;
  author?: string | null;
  url?: string | null;
  mimeType?: string | null;
  size?: number | null;
  publishedAt?: string | null;
  sourceCreatedAt?: string | null;
  sourceUpdatedAt?: string | null;
  filePath?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Lazily read and extract the document body. */
  load: () => Promise<LoadedContent>;
}

export interface ScanSummary {
  /** True when the scan covered the entire configured scope. */
  complete: boolean;
  scanned: number;
  skipped?: number;
  note?: string;
}

export interface Connector {
  type: SourceType;
  label: string;
  description: string;
  test(config: Record<string, unknown>): Promise<TestResult>;
  scan(config: Record<string, unknown>, ctx: SyncContext): AsyncGenerator<ScanItem, ScanSummary>;
}

export interface SourceConfigMap {
  local: {
    path: string;
    includeExtensions?: string[];
    excludeGlobs?: string[];
    maxFileSizeMb?: number;
    maxFiles?: number;
    followSymlinks?: boolean;
  };
  smb: {
    host: string;
    share: string;
    username: string;
    password: string;
    domain?: string;
    basePath?: string;
    includeExtensions?: string[];
    excludeGlobs?: string[];
    maxFileSizeMb?: number;
    maxFiles?: number;
  };
  cubox: {
    apiLink?: string;
    server?: string;
    token?: string;
    folderIds?: string[];
    tagIds?: string[];
    limit?: number;
    includeArchived?: boolean;
    fetchDetails?: boolean;
    sinceDays?: number;
  };
  yuque: {
    token: string;
    login?: string;
    repoIds?: string[];
    includePublic?: boolean;
    maxDocs?: number;
  };
}
