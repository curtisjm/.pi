import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebAccessCache } from "../src/cache.ts";
import { DEFAULT_WEB_ACCESS_TTLS } from "../src/config.ts";
import { normalizeFirecrawlDocument } from "../src/providers/firecrawl.ts";
import { WebRouter } from "../src/router.ts";
import type { GitHubProvider, PageContent, PageFetcher, WebAccessConfig } from "../src/types.ts";
import { DirectFetchRejectedError } from "../src/utils/errors.ts";
import { fetchUrlWithRouting, normalizeFetchUrls, renderWebFetchResult } from "../src/tools/web-fetch-core.ts";

const config: WebAccessConfig = {
  envPath: "/tmp/.env",
  cacheDbPath: "/tmp/cache.sqlite",
  keys: { exa: "missing", firecrawl: "missing", githubToken: "missing" },
  ttls: DEFAULT_WEB_ACCESS_TTLS,
};

test("normalizeFirecrawlDocument maps markdown document", () => {
  const page = normalizeFirecrawlDocument(
    "https://example.com",
    { markdown: "# Title", metadata: { title: "Title", sourceURL: "https://example.com", statusCode: 200 } },
    new Date("2026-01-01T00:00:00.000Z"),
  );

  assert.equal(page.source, "firecrawl");
  assert.equal(page.title, "Title");
  assert.equal(page.markdown, "# Title");
});

test("normalizeFetchUrls rejects empty and caps at five", () => {
  assert.deepEqual(normalizeFetchUrls({ url: " https://a.test ", urls: ["https://b.test", "https://a.test"] }), [
    "https://a.test",
    "https://b.test",
  ]);
  assert.throws(() => normalizeFetchUrls({}), /requires url/);
  assert.throws(() => normalizeFetchUrls({ urls: ["1", "2", "3", "4", "5", "6"] }), /at most 5/);
});

test("fetchUrlWithRouting uses direct fetch cache and avoids repeated provider calls", async () => {
  const { cache, cleanup } = makeTempCache();
  let directCalls = 0;
  const directFetcher: PageFetcher = {
    async fetchPage(url) {
      directCalls += 1;
      return page(url, "direct-http", "direct content");
    },
  };

  try {
    const deps = makeDeps(cache, { directFetcher });
    const first = await fetchUrlWithRouting("https://raw.githubusercontent.com/o/r/main/README.md", {}, deps);
    const second = await fetchUrlWithRouting("https://raw.githubusercontent.com/o/r/main/README.md", {}, deps);
    assert.equal(first.source, "direct-http");
    assert.equal(second.source, "cache");
    assert.equal(directCalls, 1);
  } finally {
    cleanup();
  }
});

test("fetchUrlWithRouting routes GitHub Gist pages to raw direct content", async () => {
  const { cache, cleanup } = makeTempCache();
  let observedUrl: string | undefined;
  const directFetcher: PageFetcher = {
    async fetchPage(url) {
      observedUrl = url;
      return page(url, "direct-http", "# Gist raw markdown");
    },
  };
  const firecrawlFetcher: PageFetcher = {
    async fetchPage() {
      throw new Error("Firecrawl should not be used for gist pages in auto mode");
    },
  };

  try {
    const result = await fetchUrlWithRouting(
      "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f",
      {},
      makeDeps(cache, { directFetcher, firecrawlFetcher }),
    );
    assert.equal(observedUrl, "https://gist.githubusercontent.com/karpathy/442a6bf555914893e9891c11519de94f/raw");
    assert.equal(result.source, "direct-http");
    assert.equal(result.markdown, "# Gist raw markdown");
  } finally {
    cleanup();
  }
});

test("fetchUrlWithRouting falls back from rejected direct HTML to Firecrawl without exposing HTML", async () => {
  const { cache, cleanup } = makeTempCache();
  const progress: string[] = [];
  const directFetcher: PageFetcher = {
    async fetchPage() {
      throw new DirectFetchRejectedError("Direct fetch returned HTML in auto mode");
    },
  };
  let observedFetchMode: string | undefined;
  const firecrawlFetcher: PageFetcher = {
    async fetchPage(url, options) {
      observedFetchMode = options?.fetchMode;
      return page(url, "firecrawl", "# Clean markdown");
    },
  };

  try {
    const result = await fetchUrlWithRouting("https://example.com/data.json", {}, makeDeps(cache, { directFetcher, firecrawlFetcher, onProgress: (m) => progress.push(m) }));
    assert.equal(result.source, "firecrawl");
    assert.equal(result.markdown.includes("<html>"), false);
    assert.equal(observedFetchMode, "auto");
    assert.deepEqual(progress, ["Trying direct fetch...", "Falling back to Firecrawl for clean markdown..."]);
  } finally {
    cleanup();
  }
});

test("fetchUrlWithRouting passes resolved fetchMode to direct Firecrawl route", async () => {
  const { cache, cleanup } = makeTempCache();
  let observedFetchMode: string | undefined;
  const firecrawlFetcher: PageFetcher = {
    async fetchPage(url, options) {
      observedFetchMode = options?.fetchMode;
      return page(url, "firecrawl", "# Clean markdown");
    },
  };

  try {
    await fetchUrlWithRouting("https://example.com/page", {}, makeDeps(cache, { firecrawlFetcher }));
    assert.equal(observedFetchMode, "auto");
  } finally {
    cleanup();
  }
});

test("renderWebFetchResult caps single-page content and includes retrieval calls", () => {
  const big = "x".repeat(21_000);
  const output = renderWebFetchResult("web_123", [page("https://example.com", "firecrawl", big)]);
  assert.match(output, /Content capped/);
  assert.match(output, /get_web_content\(\{ responseId: "web_123", urlIndex: 0, offset: 20000/);
  assert.match(output, /full: true/);
});

test("renderWebFetchResult summarizes multi-page content", () => {
  const output = renderWebFetchResult("web_123", [page("https://a.test", "firecrawl", "A"), page("https://b.test", "direct-http", "B")]);
  assert.match(output, /Fetched 2 URLs/);
  assert.match(output, /urlIndex: 1/);
});

function makeTempCache() {
  const dir = mkdtempSync(join(tmpdir(), "web-access-fetch-test-"));
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  return {
    cache,
    cleanup() {
      cache.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeDeps(
  cache: WebAccessCache,
  overrides: Partial<{
    directFetcher: PageFetcher;
    firecrawlFetcher: PageFetcher;
    githubProvider: GitHubProvider;
    onProgress: (message: string) => void;
  }> = {},
) {
  return {
    cache,
    config,
    router: new WebRouter(),
    directFetcher: overrides.directFetcher ?? ({ async fetchPage(url) { return page(url, "direct-http", "direct"); } } satisfies PageFetcher),
    firecrawlFetcher: overrides.firecrawlFetcher ?? ({ async fetchPage(url) { return page(url, "firecrawl", "firecrawl"); } } satisfies PageFetcher),
    githubProvider: overrides.githubProvider ?? ({ canHandle: () => null, async fetchGitHub(url) { return page(url, "github-api", "github"); } } satisfies GitHubProvider),
    onProgress: overrides.onProgress,
  };
}

function page(url: string, source: PageContent["source"], markdown: string): PageContent {
  return {
    url,
    title: null,
    markdown,
    source,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "hash",
  };
}
