import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { WEB_ACCESS_CACHE_DB_PATH } from "./config.ts";
import type { PageContent, SearchProviderName, SearchResponse } from "./types.ts";
import { makeResponseId, stableStringify } from "./utils/hash.ts";

export interface CacheOptions {
  dbPath?: string;
  now?: () => Date;
}

export interface StoredResponse<T = unknown> {
  responseId: string;
  kind: string;
  payload: T;
  createdAt: string;
  expiresAt: string | null;
}

export interface GitHubCloneRecord {
  cacheKey: string;
  owner: string;
  repo: string;
  ref?: string;
  localPath: string;
  clonedAt: string;
  expiresAt: string | null;
  metadata?: Record<string, unknown>;
}

type DbRow = Record<string, unknown>;

const CACHE_SCHEMA_VERSION = "1";

export class WebAccessCache {
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(options: CacheOptions = {}) {
    this.dbPath = options.dbPath ?? WEB_ACCESS_CACHE_DB_PATH;
    this.now = options.now ?? (() => new Date());

    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  getSearch(cacheKey: string, options: { forceRefresh?: boolean } = {}): SearchResponse | null {
    if (options.forceRefresh) return null;

    const row = this.db
      .prepare("SELECT * FROM web_searches WHERE cache_key = ?")
      .get(cacheKey) as DbRow | undefined;
    if (!row || isExpired(row.expires_at, this.now())) return null;

    return {
      query: String(row.query),
      provider: String(row.provider) as SearchProviderName,
      searchedAt: String(row.searched_at),
      cacheHit: true,
      results: parseJson(String(row.results_json), []),
    };
  }

  setSearch(args: {
    cacheKey: string;
    query: string;
    provider: SearchProviderName;
    options: unknown;
    response: SearchResponse;
    ttlHours: number | null;
  }): void {
    const searchedAt = args.response.searchedAt || this.now().toISOString();
    const expiresAt = ttlToExpiresAt(args.ttlHours, this.now());
    this.db
      .prepare(
        `INSERT OR REPLACE INTO web_searches
          (cache_key, query, provider, options_json, results_json, searched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.cacheKey,
        args.query,
        args.provider,
        stableStringify(args.options),
        JSON.stringify(args.response.results),
        searchedAt,
        expiresAt,
      );
  }

  getPage(cacheKey: string, options: { forceRefresh?: boolean } = {}): PageContent | null {
    if (options.forceRefresh) return null;

    const row = this.db.prepare("SELECT * FROM web_pages WHERE cache_key = ?").get(cacheKey) as DbRow | undefined;
    if (!row || isExpired(row.expires_at, this.now())) return null;

    const metadata = parseJson<Record<string, unknown> | undefined>(String(row.metadata_json ?? "null"), undefined);
    return {
      url: String(row.url),
      title: row.title === null || row.title === undefined ? null : String(row.title),
      markdown: String(row.markdown),
      source: "cache",
      fetchedAt: String(row.fetched_at),
      contentHash: String(row.content_hash),
      metadata: {
        ...(metadata ?? {}),
        cachedSource: String(row.source),
      },
    };
  }

  setPage(args: {
    cacheKey: string;
    normalizedUrl: string;
    page: PageContent;
    ttlHours: number | null;
  }): void {
    const expiresAt = ttlToExpiresAt(args.ttlHours, this.now());
    this.db
      .prepare(
        `INSERT OR REPLACE INTO web_pages
          (cache_key, url, normalized_url, title, markdown, fetched_at, expires_at, content_hash, source, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.cacheKey,
        args.page.url,
        args.normalizedUrl,
        args.page.title,
        args.page.markdown,
        args.page.fetchedAt,
        expiresAt,
        args.page.contentHash,
        args.page.source,
        JSON.stringify(args.page.metadata ?? null),
      );
  }

  createResponse<T>(kind: string, payload: T, ttlHours: number | null): StoredResponse<T> {
    const responseId = makeResponseId(kind.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "web");
    const createdAt = this.now().toISOString();
    const expiresAt = ttlToExpiresAt(ttlHours, this.now());

    this.db
      .prepare(
        `INSERT INTO web_responses (response_id, kind, payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(responseId, kind, JSON.stringify(payload), createdAt, expiresAt);

    return { responseId, kind, payload, createdAt, expiresAt };
  }

  getResponse<T = unknown>(responseId: string): StoredResponse<T> | null {
    const row = this.db
      .prepare("SELECT * FROM web_responses WHERE response_id = ?")
      .get(responseId) as DbRow | undefined;
    if (!row || isExpired(row.expires_at, this.now())) return null;

    return {
      responseId: String(row.response_id),
      kind: String(row.kind),
      payload: parseJson<T>(String(row.payload_json), undefined as T),
      createdAt: String(row.created_at),
      expiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    };
  }

  getGitHubClone(cacheKey: string, options: { forceRefresh?: boolean } = {}): GitHubCloneRecord | null {
    if (options.forceRefresh) return null;

    const row = this.db
      .prepare("SELECT * FROM github_clones WHERE cache_key = ?")
      .get(cacheKey) as DbRow | undefined;
    if (!row || isExpired(row.expires_at, this.now())) return null;

    return rowToClone(row);
  }

  setGitHubClone(args: Omit<GitHubCloneRecord, "cacheKey" | "clonedAt" | "expiresAt"> & {
    cacheKey: string;
    ttlHours: number | null;
    clonedAt?: string;
  }): GitHubCloneRecord {
    const clonedAt = args.clonedAt ?? this.now().toISOString();
    const expiresAt = ttlToExpiresAt(args.ttlHours, this.now());

    this.db
      .prepare(
        `INSERT OR REPLACE INTO github_clones
          (cache_key, owner, repo, ref, local_path, cloned_at, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.cacheKey,
        args.owner,
        args.repo,
        args.ref ?? null,
        args.localPath,
        clonedAt,
        expiresAt,
        JSON.stringify(args.metadata ?? null),
      );

    return {
      cacheKey: args.cacheKey,
      owner: args.owner,
      repo: args.repo,
      ref: args.ref,
      localPath: args.localPath,
      clonedAt,
      expiresAt,
      metadata: args.metadata,
    };
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS web_pages (
        cache_key TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        title TEXT,
        markdown TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT,
        content_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_web_pages_url ON web_pages(normalized_url);

      CREATE TABLE IF NOT EXISTS web_searches (
        cache_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        provider TEXT NOT NULL,
        options_json TEXT NOT NULL,
        results_json TEXT NOT NULL,
        searched_at TEXT NOT NULL,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS web_responses (
        response_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS github_clones (
        cache_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        ref TEXT,
        local_path TEXT NOT NULL,
        cloned_at TEXT NOT NULL,
        expires_at TEXT,
        metadata_json TEXT
      );
    `);

    this.db
      .prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)")
      .run("schema_version", CACHE_SCHEMA_VERSION);
  }
}

export function ttlToExpiresAt(ttlHours: number | null, now: Date = new Date()): string | null {
  if (ttlHours === null) return null;
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

export function isExpired(expiresAt: unknown, now: Date = new Date()): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") return false;
  const time = Date.parse(String(expiresAt));
  return Number.isFinite(time) && time <= now.getTime();
}

function rowToClone(row: DbRow): GitHubCloneRecord {
  return {
    cacheKey: String(row.cache_key),
    owner: String(row.owner),
    repo: String(row.repo),
    ref: row.ref === null || row.ref === undefined ? undefined : String(row.ref),
    localPath: String(row.local_path),
    clonedAt: String(row.cloned_at),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    metadata: parseJson<Record<string, unknown> | undefined>(String(row.metadata_json ?? "null"), undefined),
  };
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
