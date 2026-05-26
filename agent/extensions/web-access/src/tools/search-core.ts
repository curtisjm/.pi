import type { WebAccessCache } from "../cache.ts";
import type { SearchOptions, SearchProvider, SearchResponse } from "../types.ts";
import { makeCacheKey } from "../utils/hash.ts";

export interface WebSearchParams {
  query?: string;
  queries?: string[];
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  recency?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
}

export interface SearchResponsePayload {
  kind: "web_search" | "code_search";
  createdAt: string;
  responses: SearchResponse[];
  content: string;
}

export async function searchWithCache(args: {
  cache: WebAccessCache;
  provider: SearchProvider;
  query: string;
  options: SearchOptions;
  ttlHours: number;
}): Promise<SearchResponse> {
  const keyOptions = normalizedSearchCacheOptions(args.options);
  const cacheKey = makeCacheKey("search", {
    schema: 1,
    provider: args.options.provider ?? "exa",
    kind: args.options.kind ?? "web",
    query: args.query,
    options: keyOptions,
  });

  const cached = args.cache.getSearch(cacheKey, { forceRefresh: args.options.forceRefresh });
  if (cached) return cached;

  const response = await args.provider.search(args.query, args.options);
  args.cache.setSearch({
    cacheKey,
    query: args.query,
    provider: response.provider,
    options: keyOptions,
    response,
    ttlHours: args.ttlHours,
  });
  return response;
}

export function normalizeQueries(params: Pick<WebSearchParams, "query" | "queries">): string[] {
  const queries = [params.query, ...(params.queries ?? [])]
    .filter((query): query is string => typeof query === "string")
    .map((query) => query.trim())
    .filter(Boolean);

  const unique = [...new Set(queries)];
  if (unique.length === 0) throw new Error("web_search requires query or queries.");
  if (unique.length > 4) throw new Error("web_search supports at most 4 queries per call.");
  return unique;
}

function normalizedSearchCacheOptions(options: SearchOptions): Record<string, unknown> {
  return {
    maxResults: options.maxResults,
    includeDomains: options.includeDomains,
    excludeDomains: options.excludeDomains,
    recency: options.recency,
    kind: options.kind,
    maxCharacters: options.maxCharacters,
  };
}
