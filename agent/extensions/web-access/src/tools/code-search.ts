import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { SearchOptions, SearchResponse } from "../types.ts";
import { capText, clampInteger, formatCapDisclosure } from "../utils/caps.ts";
import type { SearchToolDeps } from "./web-search.ts";
import type { SearchResponsePayload } from "./search-core.ts";
import { searchWithCache } from "./search-core.ts";

export interface CodeSearchParams {
  query: string;
  maxResults?: number;
  maxCharacters?: number;
  forceRefresh?: boolean;
}

export function registerCodeSearchTool(pi: ExtensionAPI, deps: SearchToolDeps): void {
  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description: "Search programming docs, APIs, examples, GitHub issues, and source references using Exa. Returns capped output.",
    promptSnippet: "Search for programming docs, APIs, examples, GitHub issues, and source references with compact capped output.",
    promptGuidelines: [
      "Use code_search for programming/library/API questions before implementing against unfamiliar APIs.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Single code/docs/API/examples search query" }),
      maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 10, description: "Default 8, maximum 10" })),
      maxCharacters: Type.Optional(Type.Number({ minimum: 1, maximum: 30_000, description: "Default 12000, maximum 30000" })),
      forceRefresh: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params: CodeSearchParams) {
      const query = params.query?.trim();
      if (!query) throw new Error("code_search requires a non-empty query.");

      const maxResults = clampInteger(params.maxResults, 8, 10);
      const maxCharacters = clampInteger(params.maxCharacters, 12_000, 30_000);
      const cache = deps.getCache();
      const response = await searchWithCache({
        cache,
        provider: deps.getSearchProvider(),
        query,
        ttlHours: deps.config.ttls.searchTtlHours,
        options: {
          kind: "code",
          provider: "exa",
          maxResults,
          maxCharacters,
          forceRefresh: params.forceRefresh,
        } satisfies SearchOptions,
      });

      const fullContent = renderCodeSearchResponse(response);
      const stored = cache.createResponse<SearchResponsePayload>(
        "code_search",
        {
          kind: "code_search",
          createdAt: new Date().toISOString(),
          responses: [response],
          content: fullContent,
        },
        deps.config.ttls.responseTtlHours,
      );

      const capped = capText(fullContent, maxCharacters);
      const capNote = capped.capped
        ? `\n\n${formatCapDisclosure({ responseId: stored.responseId, selector: "queryIndex: 0", capped })}`
        : `\n\nFull normalized code_search content is stored as responseId "${stored.responseId}". To retrieve it: get_web_content({ responseId: "${stored.responseId}", queryIndex: 0, full: true })`;

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `code_search responseId: "${stored.responseId}"`,
              `Cache: ${response.cacheHit ? "hit" : "miss"}. Results: ${response.results.length}.`,
              capped.text,
            ].join("\n\n") + capNote,
          },
        ],
        details: {
          responseId: stored.responseId,
          resultCount: response.results.length,
          cacheHit: response.cacheHit,
          fullCharacters: capped.fullLength,
          returnedCharacters: capped.returnedLength,
        },
      };
    },
  });
}

export function renderCodeSearchResponse(response: SearchResponse): string {
  const lines = [`Query: ${response.query}`];
  response.results.forEach((result, index) => {
    lines.push(`\n${index + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    if (result.publishedDate) lines.push(`Published: ${result.publishedDate}`);
    if (result.author) lines.push(`Author: ${result.author}`);
    if (result.snippet) lines.push(`Snippet:\n${result.snippet.trim()}`);
    if (result.highlights?.length) {
      lines.push("Highlights:");
      result.highlights.slice(0, 5).forEach((highlight) => lines.push(`- ${highlight.trim()}`));
    }
  });
  lines.push("\nIf a source needs full context, call web_fetch for its URL.");
  return lines.join("\n");
}
