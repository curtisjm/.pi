import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebAccessCache, isExpired, ttlToExpiresAt } from "../src/cache.ts";
import { makeCacheKey, stableStringify } from "../src/utils/hash.ts";

test("stableStringify sorts object keys recursively", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(makeCacheKey("x", { b: 1, a: 2 }), makeCacheKey("x", { a: 2, b: 1 }));
});

test("ttl helpers detect expiry", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(ttlToExpiresAt(null, now), null);
  assert.equal(ttlToExpiresAt(1, now), "2026-01-01T01:00:00.000Z");
  assert.equal(isExpired("2025-12-31T23:59:59.000Z", now), true);
  assert.equal(isExpired("2026-01-01T00:00:01.000Z", now), false);
});

test("cache stores search entries and honors forceRefresh", () => {
  const { cache, cleanup } = makeTempCache(new Date("2026-01-01T00:00:00.000Z"));
  try {
    const cacheKey = makeCacheKey("search", { query: "pi" });
    cache.setSearch({
      cacheKey,
      query: "pi",
      provider: "exa",
      options: { maxResults: 1 },
      ttlHours: 24,
      response: {
        query: "pi",
        provider: "exa",
        searchedAt: "2026-01-01T00:00:00.000Z",
        cacheHit: false,
        results: [{ title: "Pi", url: "https://example.com", domain: "example.com" }],
      },
    });

    const hit = cache.getSearch(cacheKey);
    assert.equal(hit?.cacheHit, true);
    assert.equal(hit?.results[0]?.title, "Pi");
    assert.equal(cache.getSearch(cacheKey, { forceRefresh: true }), null);
  } finally {
    cleanup(cache);
  }
});

test("cache misses expired search entries", () => {
  let now = new Date("2026-01-01T00:00:00.000Z");
  const { cache, cleanup } = makeTempCache(() => now);
  try {
    const cacheKey = makeCacheKey("search", { query: "expired" });
    cache.setSearch({
      cacheKey,
      query: "expired",
      provider: "exa",
      options: {},
      ttlHours: 1,
      response: {
        query: "expired",
        provider: "exa",
        searchedAt: now.toISOString(),
        cacheHit: false,
        results: [],
      },
    });

    now = new Date("2026-01-01T02:00:00.000Z");
    assert.equal(cache.getSearch(cacheKey), null);
  } finally {
    cleanup(cache);
  }
});

test("cache stores pages, responses, and GitHub clone metadata", () => {
  const { cache, cleanup } = makeTempCache(new Date("2026-01-01T00:00:00.000Z"));
  try {
    const pageKey = makeCacheKey("page", { url: "https://example.com" });
    cache.setPage({
      cacheKey: pageKey,
      normalizedUrl: "https://example.com/",
      ttlHours: 168,
      page: {
        url: "https://example.com/",
        title: "Example",
        markdown: "# Example",
        source: "direct-http",
        fetchedAt: "2026-01-01T00:00:00.000Z",
        contentHash: "abc",
      },
    });
    assert.equal(cache.getPage(pageKey)?.source, "cache");
    assert.equal(cache.getPage(pageKey)?.metadata?.cachedSource, "direct-http");

    const response = cache.createResponse("web_fetch", { pages: [{ url: "https://example.com/" }] }, 24);
    assert.equal(cache.getResponse<{ pages: Array<{ url: string }> }>(response.responseId)?.payload.pages[0]?.url, "https://example.com/");

    const cloneKey = makeCacheKey("github", { owner: "o", repo: "r", ref: "main" });
    cache.setGitHubClone({
      cacheKey: cloneKey,
      owner: "o",
      repo: "r",
      ref: "main",
      localPath: "/tmp/repo",
      ttlHours: 24,
      metadata: { via: "test" },
    });
    assert.equal(cache.getGitHubClone(cloneKey)?.localPath, "/tmp/repo");
    assert.equal(cache.getGitHubClone(cloneKey, { forceRefresh: true }), null);
  } finally {
    cleanup(cache);
  }
});

function makeTempCache(now: Date | (() => Date)) {
  const dir = mkdtempSync(join(tmpdir(), "web-access-cache-test-"));
  const nowFn = typeof now === "function" ? now : () => now;
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite"), now: nowFn });
  return {
    cache,
    cleanup(cacheToClose: WebAccessCache) {
      cacheToClose.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
