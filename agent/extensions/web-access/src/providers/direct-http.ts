import type { FetchOptions, PageContent } from "../types.ts";
import { contentHash } from "../utils/hash.ts";
import {
  domainFromUrl,
  isDirectFetchContentType,
  isLikelyHtml,
  normalizeUrl,
  shouldTryDirectFetch,
} from "../utils/urls.ts";
import { DirectFetchRejectedError } from "../utils/errors.ts";

export interface DirectHttpFetcherOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class DirectHttpFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: DirectHttpFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async fetchPage(url: string, options: FetchOptions = {}): Promise<PageContent> {
    const normalizedUrl = normalizeUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

    try {
      const response = await this.fetchImpl(normalizedUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/plain,text/markdown,application/json,application/xml,text/xml,*/*;q=0.2",
          "User-Agent": "pi-web-access/1.0 (+https://github.com/curtisjm/.pi)",
        },
      });

      if (!response.ok) {
        throw new Error(`Direct HTTP fetch failed with ${response.status} ${response.statusText}`.trim());
      }

      const contentType = response.headers.get("content-type");
      const autoMode = (options.fetchMode ?? "auto") === "auto";
      if (autoMode && !shouldTryDirectFetch(normalizedUrl, contentType)) {
        throw new DirectFetchRejectedError("Direct fetch skipped because the URL/content-type is not agent-friendly");
      }

      const text = await response.text();
      if (autoMode && (isLikelyHtml(text) || contentType?.toLowerCase().includes("text/html"))) {
        // Do not expose or cache messy direct HTML in auto mode. The router will
        // fall back to Firecrawl for clean markdown.
        throw new DirectFetchRejectedError("Direct fetch returned HTML in auto mode");
      }

      const markdown = formatDirectContent(text, contentType, normalizedUrl);
      return {
        url: normalizedUrl,
        title: titleFromHeadersOrUrl(response.headers, normalizedUrl),
        markdown,
        source: "direct-http",
        fetchedAt: this.now().toISOString(),
        contentHash: contentHash(markdown),
        metadata: {
          contentType,
          domain: domainFromUrl(normalizedUrl),
          directContentTypeEligible: isDirectFetchContentType(contentType),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function formatDirectContent(text: string, contentType: string | null, url: string): string {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mime === "application/json" || mime === "application/ld+json" || url.endsWith(".json")) {
    return `\`\`\`json\n${text}\n\`\`\``;
  }
  if (mime.includes("xml") || url.endsWith(".xml")) {
    return `\`\`\`xml\n${text}\n\`\`\``;
  }
  return text;
}

function titleFromHeadersOrUrl(headers: Headers, url: string): string | null {
  const contentDisposition = headers.get("content-disposition");
  const filenameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i);
  if (filenameMatch?.[1]) return decodeURIComponent(filenameMatch[1]);

  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    return last || parsed.hostname;
  } catch {
    return null;
  }
}
