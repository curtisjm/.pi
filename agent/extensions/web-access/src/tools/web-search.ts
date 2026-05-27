import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { WebAccessCache } from "../cache.ts";
import type { SearchProvider, SearchResponse, WebAccessConfig } from "../types.ts";
import { clampInteger } from "../utils/caps.ts";
import type { SearchResponsePayload, WebSearchParams } from "./search-core.ts";
import { normalizeQueries, searchWithCache } from "./search-core.ts";

export interface SearchToolDeps {
  getCache: () => WebAccessCache;
  getSearchProvider: () => SearchProvider;
  config: WebAccessConfig;
}

export function registerWebSearchTool(pi: ExtensionAPI, deps: SearchToolDeps): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web with Exa for compact source discovery. Returns capped snippets; use web_fetch to read selected URLs.",
    promptSnippet: "Search the web with Exa for compact source discovery; use web_fetch to read selected sources fully.",
    promptGuidelines: [
      "Use web_search for discovering relevant web sources; do not use it when you already have a URL to read.",
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Single search query" })),
      queries: Type.Optional(Type.Array(Type.String(), { maxItems: 4, description: "Multiple search queries, maximum 4" })),
      maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, description: "Default 5, maximum 10" })),
      includeDomains: Type.Optional(Type.Array(Type.String())),
      excludeDomains: Type.Optional(Type.Array(Type.String())),
      recency: Type.Optional(StringEnum(["day", "week", "month", "year"] as const)),
      forceRefresh: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: WebSearchParams) {
      const queries = normalizeQueries(params);
      const maxResults = clampInteger(params.maxResults, 5, 10);
      const cache = deps.getCache();
      const provider = deps.getSearchProvider();
      const responses: SearchResponse[] = [];

      for (const query of queries) {
        responses.push(
          await searchWithCache({
            cache,
            provider,
            query,
            options: {
              kind: "web",
              provider: "exa",
              maxResults,
              includeDomains: params.includeDomains,
              excludeDomains: params.excludeDomains,
              recency: params.recency,
              forceRefresh: params.forceRefresh,
            },
            ttlHours: deps.config.ttls.searchTtlHours,
          }),
        );
      }

      const rendered = renderWebSearchResponses(responses);
      const stored = cache.createResponse<SearchResponsePayload>(
        "web_search",
        {
          kind: "web_search",
          createdAt: new Date().toISOString(),
          responses,
          content: rendered,
        },
        deps.config.ttls.responseTtlHours,
      );

      const text = [
        `web_search responseId: "${stored.responseId}"`,
        cacheSummary(responses),
        rendered,
        "Use web_fetch({ url: \"...\" }) to read a selected source fully.",
        `Stored search result details can be retrieved with get_web_content({ responseId: "${stored.responseId}" }).`,
      ].join("\n\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {
          responseId: stored.responseId,
          queryCount: responses.length,
          resultCount: responses.reduce((sum, response) => sum + response.results.length, 0),
          cacheHits: responses.filter((response) => response.cacheHit).length,
        },
      };
    },
  });
}

export function renderWebSearchResponses(responses: SearchResponse[]): string {
  return responses
    .map((response, queryIndex) => {
      const lines = [`Query ${queryIndex + 1}: ${response.query}`];
      response.results.forEach((result, index) => {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   URL: ${result.url}`);
        if (result.publishedDate) lines.push(`   Published: ${result.publishedDate}`);
        const snippet = result.snippet ?? result.highlights?.[0];
        if (snippet) lines.push(`   Snippet: ${compactLine(snippet, 500)}`);
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

function cacheSummary(responses: SearchResponse[]): string {
  const hits = responses.filter((response) => response.cacheHit).length;
  return `Cache: ${hits} hit(s), ${responses.length - hits} miss(es).`;
}

function compactLine(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}
