import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
import { registerGetWebContentTool } from "./src/tools/get-web-content.ts";
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
  registerGetWebContentTool(pi, { getCache });
}
