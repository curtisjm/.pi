import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { WebAccessCache } from "./src/cache.ts";
import {
  formatMissingProviderWarning,
  formatWebAccessDiagnostics,
  loadWebAccessConfig,
} from "./src/config.ts";
import { ExaSearchProvider } from "./src/providers/exa.ts";
import { registerCodeSearchTool } from "./src/tools/code-search.ts";
import { registerWebSearchTool } from "./src/tools/web-search.ts";
import type { SearchProvider } from "./src/types.ts";

export default function webAccessExtension(pi: ExtensionAPI) {
  const startupConfig = loadWebAccessConfig();
  let cache: WebAccessCache | undefined;
  let searchProvider: SearchProvider | undefined;

  const getCache = () => {
    cache ??= new WebAccessCache();
    return cache;
  };
  const getSearchProvider = () => {
    searchProvider ??= new ExaSearchProvider();
    return searchProvider;
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
  registerRemainingPlaceholderTools(pi);
}

function registerRemainingPlaceholderTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch URL content cleanly with capped output. Placeholder until Phase 7 is implemented.",
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
    async execute() {
      return notImplementedResult("web_fetch", 7);
    },
  });

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
      return notImplementedResult("get_web_content", 8);
    },
  });
}

function notImplementedResult(toolName: string, phase: number) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${toolName} is registered but not implemented yet. Phase ${phase} will add execution behavior. No provider API calls were made.`,
      },
    ],
    details: {
      implemented: false,
      plannedPhase: phase,
    },
  };
}
