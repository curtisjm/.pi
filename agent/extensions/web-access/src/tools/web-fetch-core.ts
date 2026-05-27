import type { WebAccessCache } from "../cache.ts";
import { WebRouter } from "../router.ts";
import type { FetchMode, FetchOptions, GitHubProvider, PageContent, PageFetcher, WebAccessConfig } from "../types.ts";
import { capText, formatCapDisclosure } from "../utils/caps.ts";
import { DirectFetchRejectedError } from "../utils/errors.ts";
import { makeCacheKey } from "../utils/hash.ts";
import { normalizeUrl } from "../utils/urls.ts";

export interface WebFetchParams extends FetchOptions {
  url?: string;
  urls?: string[];
}

export interface WebFetchDeps {
  cache: WebAccessCache;
  config: WebAccessConfig;
  router: WebRouter;
  directFetcher: PageFetcher;
  firecrawlFetcher: PageFetcher;
  githubProvider: GitHubProvider;
  onProgress?: (message: string) => void;
}

export interface WebFetchResponsePayload {
  kind: "web_fetch";
  createdAt: string;
  pages: PageContent[];
}

export function normalizeFetchUrls(params: Pick<WebFetchParams, "url" | "urls">): string[] {
  const urls = [params.url, ...(params.urls ?? [])]
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter(Boolean);
  const unique = [...new Set(urls)];
  if (unique.length === 0) throw new Error("web_fetch requires url or urls.");
  if (unique.length > 5) throw new Error("web_fetch supports at most 5 URLs per call.");
  return unique;
}

export async function fetchUrlWithRouting(url: string, options: FetchOptions, deps: WebFetchDeps): Promise<PageContent> {
  const normalizedUrl = normalizeUrl(url);
  const fetchMode = options.fetchMode ?? "auto";
  const pageCacheKey = makePageCacheKey(normalizedUrl, options);
  const cached = deps.cache.getPage(pageCacheKey, { forceRefresh: options.forceRefresh });
  if (cached) return cached;

  const route = deps.router.route(normalizedUrl, options);
  let page: PageContent;

  if (route.kind === "github") {
    page = await deps.githubProvider.fetchGitHub(route.url, options);
  } else if (route.kind === "direct-http") {
    try {
      deps.onProgress?.("Trying direct fetch...");
      page = await deps.directFetcher.fetchPage(route.url, { ...options, fetchMode });
    } catch (error) {
      if (fetchMode === "auto" && error instanceof DirectFetchRejectedError) {
        deps.onProgress?.("Falling back to Firecrawl for clean markdown...");
        page = await deps.firecrawlFetcher.fetchPage(route.url, { ...options, fetchMode });
      } else {
        throw error;
      }
    }
  } else {
    page = await deps.firecrawlFetcher.fetchPage(route.url, { ...options, fetchMode });
  }

  deps.cache.setPage({
    cacheKey: pageCacheKey,
    normalizedUrl,
    page,
    ttlHours: deps.config.ttls.pageTtlHours,
  });
  return page;
}

export function makePageCacheKey(normalizedUrl: string, options: FetchOptions): string {
  return makeCacheKey("page", {
    schema: 1,
    normalizedUrl,
    fetchMode: options.fetchMode ?? "auto",
    onlyMainContent: options.onlyMainContent ?? true,
    waitForMs: options.waitForMs,
  });
}

export function renderWebFetchResult(responseId: string, pages: PageContent[]): string {
  if (pages.length === 1) return renderSinglePage(responseId, pages[0]!);
  return renderMultiPage(responseId, pages);
}

function renderSinglePage(responseId: string, page: PageContent): string {
  const capped = capText(page.markdown, 20_000);
  const selector = "urlIndex: 0";
  const lines = [
    `web_fetch responseId: "${responseId}"`,
    `URL: ${page.url}`,
    page.title ? `Title: ${page.title}` : undefined,
    `Source: ${sourceLabel(page)}`,
    `Characters: ${page.markdown.length}`,
    "",
    capped.text,
  ].filter((line) => line !== undefined) as string[];

  if (capped.capped) {
    lines.push("", formatCapDisclosure({ responseId, selector, capped }));
  } else {
    lines.push(
      "",
      `Full content is stored as responseId "${responseId}". To retrieve it intentionally: get_web_content({ responseId: "${responseId}", urlIndex: 0, full: true })`,
    );
  }

  return lines.join("\n");
}

function renderMultiPage(responseId: string, pages: PageContent[]): string {
  const lines = [`web_fetch responseId: "${responseId}"`, `Fetched ${pages.length} URLs. Full content is stored in SQLite.`];
  pages.forEach((page, index) => {
    const preview = page.markdown.replace(/\s+/g, " ").trim().slice(0, 800);
    lines.push("");
    lines.push(`${index + 1}. ${page.title ?? page.url}`);
    lines.push(`   URL: ${page.url}`);
    lines.push(`   Source: ${sourceLabel(page)}`);
    lines.push(`   Characters: ${page.markdown.length}`);
    if (preview) lines.push(`   Preview: ${preview}${page.markdown.length > 800 ? "…" : ""}`);
    lines.push(`   Retrieve: get_web_content({ responseId: "${responseId}", urlIndex: ${index}, offset: 0, maxChars: 30000 })`);
    lines.push(`   Retrieve full intentionally: get_web_content({ responseId: "${responseId}", urlIndex: ${index}, full: true })`);
  });
  return lines.join("\n");
}

function sourceLabel(page: PageContent): string {
  if (page.source !== "cache") return page.source;
  const cachedSource = typeof page.metadata?.cachedSource === "string" ? page.metadata.cachedSource : "unknown";
  return `cache (original ${cachedSource})`;
}
