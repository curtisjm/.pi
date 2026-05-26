import { Exa } from "exa-js";
import type { RegularSearchOptions } from "exa-js";

import type { SearchOptions, SearchProvider, SearchResponse, SearchResult } from "../types.ts";
import { MissingProviderKeyError } from "../utils/errors.ts";
import { domainFromUrl } from "../utils/urls.ts";

export interface ExaSearchClient {
  search(query: string, options: RegularSearchOptions): Promise<unknown>;
}

export interface ExaSearchProviderOptions {
  apiKey?: string;
  client?: ExaSearchClient;
  now?: () => Date;
}

export class ExaSearchProvider implements SearchProvider {
  private readonly apiKey?: string;
  private readonly injectedClient?: ExaSearchClient;
  private readonly now: () => Date;

  constructor(options: ExaSearchProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.EXA_API_KEY;
    this.injectedClient = options.client;
    this.now = options.now ?? (() => new Date());
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const client = this.getClient();
    const kind = options.kind ?? "web";
    const exaOptions = buildExaSearchOptions(query, options);
    const raw = await client.search(kind === "code" ? shapeCodeQuery(query) : query, exaOptions);
    return normalizeExaSearchResponse(raw, {
      query,
      kind,
      searchedAt: this.now().toISOString(),
      maxCharacters: options.maxCharacters,
    });
  }

  private getClient(): ExaSearchClient {
    if (this.injectedClient) return this.injectedClient;
    if (!this.apiKey?.trim()) throw new MissingProviderKeyError("Exa", "EXA_API_KEY");
    return new Exa(this.apiKey.trim());
  }
}

export function buildExaSearchOptions(query: string, options: SearchOptions = {}): RegularSearchOptions {
  const kind = options.kind ?? "web";
  const base: RegularSearchOptions = {
    type: "auto",
    numResults: Math.max(1, Math.min(10, options.maxResults ?? (kind === "code" ? 8 : 5))),
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    startPublishedDate: recencyToStartPublishedDate(options.recency),
    contents:
      kind === "code"
        ? {
            highlights: { query, maxCharacters: 1_000 },
            text: { maxCharacters: Math.min(2_000, options.maxCharacters ?? 2_000) },
          }
        : {
            highlights: { query, maxCharacters: 500 },
          },
  };

  if (kind === "code") {
    return {
      ...base,
      systemPrompt:
        "Prefer official documentation, source code, GitHub issues, changelogs, API references, StackOverflow answers, and concrete code examples. Avoid duplicate sources.",
    };
  }

  return base;
}

export function normalizeExaSearchResponse(
  raw: unknown,
  context: { query: string; kind?: "web" | "code"; searchedAt: string; maxCharacters?: number },
): SearchResponse {
  const rawResults = isRecord(raw) && Array.isArray(raw.results) ? raw.results : [];
  const results = rawResults.map(normalizeExaResult).filter((result): result is SearchResult => result !== null);
  return {
    query: context.query,
    provider: "exa",
    searchedAt: context.searchedAt,
    cacheHit: false,
    results,
  };
}

function normalizeExaResult(raw: unknown): SearchResult | null {
  if (!isRecord(raw) || typeof raw.url !== "string") return null;

  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter((item): item is string => typeof item === "string")
    : undefined;

  const text = typeof raw.text === "string" ? raw.text : undefined;
  const snippet = firstNonEmpty(
    typeof raw.summary === "string" ? raw.summary : undefined,
    highlights?.[0],
    text ? text.slice(0, 1_000) : undefined,
  );

  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : raw.url,
    url: raw.url,
    domain: domainFromUrl(raw.url),
    snippet,
    highlights,
    publishedDate: typeof raw.publishedDate === "string" ? raw.publishedDate : undefined,
    author: typeof raw.author === "string" ? raw.author : undefined,
  };
}

function shapeCodeQuery(query: string): string {
  return `${query}\n\nPrefer official docs, API references, source code, examples, GitHub issues, changelogs, and concrete implementation details.`;
}

function recencyToStartPublishedDate(recency: SearchOptions["recency"]): string | undefined {
  if (!recency) return undefined;
  const now = new Date();
  const days = recency === "day" ? 1 : recency === "week" ? 7 : recency === "month" ? 31 : 365;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
