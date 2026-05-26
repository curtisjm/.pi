import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { WebRouter } from "../router.ts";
import type { GitHubProvider, PageFetcher, WebAccessConfig } from "../types.ts";
import type { WebAccessCache } from "../cache.ts";
import {
  fetchUrlWithRouting,
  normalizeFetchUrls,
  renderWebFetchResult,
  type WebFetchParams,
  type WebFetchResponsePayload,
} from "./web-fetch-core.ts";

export interface WebFetchToolDeps {
  getCache: () => WebAccessCache;
  getRouter: () => WebRouter;
  getDirectFetcher: () => PageFetcher;
  getFirecrawlFetcher: () => PageFetcher;
  getGitHubProvider: () => GitHubProvider;
  config: WebAccessConfig;
}

export function registerWebFetchTool(pi: ExtensionAPI, deps: WebFetchToolDeps): void {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch/read one or more URLs with clean capped output. Stores full content under a responseId; full uncapped retrieval is via get_web_content only.",
    promptSnippet: "Fetch URL content cleanly; clones GitHub code URLs locally and uses Firecrawl for normal webpages.",
    promptGuidelines: [
      "Use web_fetch to read selected URLs; for GitHub repository/blob/tree URLs, web_fetch provides a local clone/path when possible.",
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { maxItems: 5, description: "Multiple URLs to fetch, maximum 5" })),
      fetchMode: Type.Optional(StringEnum(["auto", "direct", "firecrawl", "github"] as const)),
      forceRefresh: Type.Optional(Type.Boolean()),
      onlyMainContent: Type.Optional(Type.Boolean()),
      waitForMs: Type.Optional(Type.Number({ minimum: 0 })),
      timeoutMs: Type.Optional(Type.Number({ minimum: 1, default: 30_000 })),
    }),
    async execute(_toolCallId, params: WebFetchParams, _signal, onUpdate) {
      const urls = normalizeFetchUrls(params);
      const cache = deps.getCache();
      const pages = [];

      for (const url of urls) {
        const page = await fetchUrlWithRouting(url, params, {
          cache,
          config: deps.config,
          router: deps.getRouter(),
          directFetcher: deps.getDirectFetcher(),
          firecrawlFetcher: deps.getFirecrawlFetcher(),
          githubProvider: deps.getGitHubProvider(),
          onProgress: (message) => onUpdate?.({ content: [{ type: "text" as const, text: message }] }),
        });
        pages.push(page);
      }

      const stored = cache.createResponse<WebFetchResponsePayload>(
        "web_fetch",
        {
          kind: "web_fetch",
          createdAt: new Date().toISOString(),
          pages,
        },
        deps.config.ttls.responseTtlHours,
      );

      return {
        content: [{ type: "text" as const, text: renderWebFetchResult(stored.responseId, pages) }],
        details: {
          responseId: stored.responseId,
          urlCount: pages.length,
          sources: pages.map((page) => page.source),
          characters: pages.map((page) => page.markdown.length),
        },
      };
    },
  });
}
