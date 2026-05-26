import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { WebAccessCache } from "./src/cache.ts";
import {
  formatMissingProviderWarning,
  formatWebAccessDiagnostics,
  loadWebAccessConfig,
} from "./src/config.ts";
import { DirectHttpFetcher } from "./src/providers/direct-http.ts";
import { ExaSearchProvider } from "./src/providers/exa.ts";
import { FirecrawlFetcher } from "./src/providers/firecrawl.ts";
import { GitHubContentProvider } from "./src/providers/github.ts";
import { WebRouter } from "./src/router.ts";
import { registerCodeSearchTool } from "./src/tools/code-search.ts";
import { registerWebFetchTool } from "./src/tools/web-fetch.ts";
import { registerWebSearchTool } from "./src/tools/web-search.ts";
import type { GitHubProvider, PageFetcher, SearchProvider } from "./src/types.ts";

export default function webAccessExtension(pi: ExtensionAPI) {
  const startupConfig = loadWebAccessConfig();
  let cache: WebAccessCache | undefined;
  let searchProvider: SearchProvider | undefined;
  let router: WebRouter | undefined;
  let directFetcher: PageFetcher | undefined;
  let firecrawlFetcher: PageFetcher | undefined;
  let githubProvider: GitHubProvider | undefined;

  const getCache = () => {
    cache ??= new WebAccessCache();
    return cache;
  };
  const getSearchProvider = () => {
    searchProvider ??= new ExaSearchProvider();
    return searchProvider;
  };
  const getRouter = () => {
    router ??= new WebRouter();
    return router;
  };
  const getDirectFetcher = () => {
    directFetcher ??= new DirectHttpFetcher();
    return directFetcher;
  };
  const getFirecrawlFetcher = () => {
    firecrawlFetcher ??= new FirecrawlFetcher();
    return firecrawlFetcher;
  };
  const getGitHubProvider = () => {
    githubProvider ??= new GitHubContentProvider({
      cache: getCache(),
      config: startupConfig,
      firecrawlFallback: getFirecrawlFetcher(),
    });
    return githubProvider;
  };

  pi.on("session_start", (_event, ctx) => {
    const warning = formatMissingProviderWarning(startupConfig);
    if (!warning) return;

    if (ctx.hasUI) {
      ctx.ui.notify(warning, "warning");
    } else {
      console.warn(warning);
    }
  });

  pi.on("session_shutdown", () => {
    cache?.close();
    cache = undefined;
  });

  pi.registerCommand("web-access", {
    description: "Show web access diagnostics without API calls or secret values",
    handler: async (_args, ctx) => {
      const diagnostics = formatWebAccessDiagnostics(loadWebAccessConfig());
      if (ctx.hasUI) {
        ctx.ui.notify(diagnostics, "info");
      } else {
        console.log(diagnostics);
      }
    },
  });

  registerWebSearchTool(pi, { getCache, getSearchProvider, config: startupConfig });
  registerCodeSearchTool(pi, { getCache, getSearchProvider, config: startupConfig });
  registerWebFetchTool(pi, {
    getCache,
    getRouter,
    getDirectFetcher,
    getFirecrawlFetcher,
    getGitHubProvider,
    config: startupConfig,
  });
  registerRemainingPlaceholderTools(pi);
}

function registerRemainingPlaceholderTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_web_content",
    label: "Get Web Content",
    description: "Retrieve stored full/capped content from prior web tools by responseId. Placeholder until Phase 8 is implemented.",
    promptSnippet: "Retrieve stored full/capped content from prior web_search/code_search/web_fetch results by responseId.",
    promptGuidelines: [
      "Use get_web_content when a previous web tool result says content was capped or stored under a responseId.",
      "Do not request get_web_content with full: true unless the full stored content is necessary; prefer offsets/chunks for very large pages.",
    ],
    parameters: Type.Object({
      responseId: Type.String({ description: "Response ID from a prior web tool call" }),
      url: Type.Optional(Type.String()),
      urlIndex: Type.Optional(Type.Number({ minimum: 0 })),
      query: Type.Optional(Type.String()),
      queryIndex: Type.Optional(Type.Number({ minimum: 0 })),
      offset: Type.Optional(Type.Number({ minimum: 0, default: 0 })),
      maxChars: Type.Optional(Type.Number({ minimum: 1, default: 30_000 })),
      full: Type.Optional(Type.Boolean()),
    }),
    async execute() {
      return {
        content: [
          {
            type: "text" as const,
            text: "get_web_content is registered but not implemented yet. Phase 8 will add response retrieval behavior. No provider API calls were made.",
          },
        ],
        details: { implemented: false, plannedPhase: 8 },
      };
    },
  });
}
