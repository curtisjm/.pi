import { FirecrawlClient } from "@mendable/firecrawl-js";
import type { Document, ScrapeOptions } from "@mendable/firecrawl-js";

import type { FetchOptions, PageContent, PageFetcher } from "../types.ts";
import { MissingProviderKeyError } from "../utils/errors.ts";
import { contentHash } from "../utils/hash.ts";
import { domainFromUrl, normalizeUrl } from "../utils/urls.ts";

export interface FirecrawlClientLike {
  scrape(url: string, options?: ScrapeOptions): Promise<Document>;
}

export interface FirecrawlFetcherOptions {
  apiKey?: string;
  client?: FirecrawlClientLike;
  now?: () => Date;
}

export class FirecrawlFetcher implements PageFetcher {
  private readonly apiKey?: string;
  private readonly injectedClient?: FirecrawlClientLike;
  private readonly now: () => Date;

  constructor(options: FirecrawlFetcherOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY;
    this.injectedClient = options.client;
    this.now = options.now ?? (() => new Date());
  }

  async fetchPage(url: string, options: FetchOptions = {}): Promise<PageContent> {
    const normalizedUrl = normalizeUrl(url);
    const client = this.getClient();
    const document = await client.scrape(normalizedUrl, {
      formats: ["markdown"],
      onlyMainContent: options.onlyMainContent ?? true,
      waitFor: options.waitForMs,
      timeout: options.timeoutMs ?? 30_000,
    });

    return normalizeFirecrawlDocument(normalizedUrl, document, this.now());
  }

  private getClient(): FirecrawlClientLike {
    if (this.injectedClient) return this.injectedClient;
    if (!this.apiKey?.trim()) throw new MissingProviderKeyError("Firecrawl", "FIRECRAWL_API_KEY");
    return new FirecrawlClient({ apiKey: this.apiKey.trim() });
  }
}

export function normalizeFirecrawlDocument(url: string, document: Document, fetchedAt: Date = new Date()): PageContent {
  const markdown = document.markdown?.trim();
  if (!markdown) throw new Error("Firecrawl returned no markdown content.");

  const title = document.metadata?.title ?? document.metadata?.ogTitle ?? null;
  return {
    url: document.metadata?.sourceURL ?? document.metadata?.url ?? url,
    title,
    markdown,
    source: "firecrawl",
    fetchedAt: fetchedAt.toISOString(),
    contentHash: contentHash(markdown),
    metadata: {
      domain: domainFromUrl(url),
      statusCode: document.metadata?.statusCode,
      contentType: document.metadata?.contentType,
      cacheState: document.metadata?.cacheState,
    },
  };
}
