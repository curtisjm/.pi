import type { FetchMode, FetchOptions, GitHubRoute } from "./types.ts";
import {
  isDirectFetchUrlCandidate,
  isGitHubCodeRoute,
  isGitHubIssueOrPullRoute,
  parseGitHubGistUrl,
  parseGitHubUrl,
  validateFetchModeForUrl,
} from "./utils/urls.ts";

export type WebRouteKind = "cache" | "github" | "direct-http" | "firecrawl";

export interface WebRouteDecision {
  kind: WebRouteKind;
  url: string;
  fetchMode: FetchMode;
  githubRoute?: GitHubRoute;
  reason: string;
}

export class WebRouter {
  route(url: string, options: FetchOptions = {}): WebRouteDecision {
    const fetchMode = options.fetchMode ?? "auto";
    validateFetchModeForUrl(fetchMode, url);

    const githubRoute = parseGitHubUrl(url);
    const gistRoute = parseGitHubGistUrl(url);

    if (fetchMode === "github") {
      return {
        kind: "github",
        url,
        fetchMode,
        githubRoute: githubRoute ?? undefined,
        reason: "fetchMode requested GitHub structured handling",
      };
    }

    if (fetchMode === "direct") {
      return {
        kind: "direct-http",
        url: gistRoute?.rawUrl ?? url,
        fetchMode,
        reason: gistRoute ? "fetchMode requested direct raw GitHub Gist content" : "fetchMode requested direct HTTP",
      };
    }

    if (fetchMode === "firecrawl") {
      return {
        kind: "firecrawl",
        url,
        fetchMode,
        reason: "fetchMode requested Firecrawl",
      };
    }

    if (gistRoute) {
      return {
        kind: "direct-http",
        url: gistRoute.rawUrl,
        fetchMode,
        reason: "GitHub Gist URL should use raw content instead of scraped GitHub chrome",
      };
    }

    if (isGitHubCodeRoute(githubRoute)) {
      return {
        kind: "github",
        url,
        fetchMode,
        githubRoute: githubRoute ?? undefined,
        reason: "GitHub repo/blob/tree URL should use local clone handling",
      };
    }

    if (isGitHubIssueOrPullRoute(githubRoute)) {
      return {
        kind: "github",
        url,
        fetchMode,
        githubRoute: githubRoute ?? undefined,
        reason: "GitHub issue/PR URL should use structured metadata before scraping",
      };
    }

    if (isDirectFetchUrlCandidate(url)) {
      return {
        kind: "direct-http",
        url,
        fetchMode,
        reason: "URL is a static/agent-friendly direct fetch candidate",
      };
    }

    return {
      kind: "firecrawl",
      url,
      fetchMode,
      reason: "Normal webpage routes to Firecrawl for clean markdown",
    };
  }
}
