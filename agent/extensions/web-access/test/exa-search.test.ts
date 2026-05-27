import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebAccessCache } from "../src/cache.ts";
import { ExaSearchProvider, buildExaSearchOptions, normalizeExaSearchResponse } from "../src/providers/exa.ts";
import { normalizeQueries, searchWithCache } from "../src/tools/search-core.ts";
import { MissingProviderKeyError } from "../src/utils/errors.ts";

const rawExaResponse = {
  results: [
    {
      title: "Docs",
      url: "https://example.com/docs",
      publishedDate: "2026-01-01",
      author: "Example",
      highlights: ["Important highlight"],
      text: "Long text",
    },
  ],
};

test("normalizeExaSearchResponse maps SDK response to internal shape", () => {
  const normalized = normalizeExaSearchResponse(rawExaResponse, {
    query: "docs",
    searchedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(normalized.provider, "exa");
  assert.equal(normalized.cacheHit, false);
  assert.equal(normalized.results[0]?.title, "Docs");
  assert.equal(normalized.results[0]?.domain, "example.com");
  assert.equal(normalized.results[0]?.snippet, "Important highlight");
});

test("buildExaSearchOptions uses compact web contents, richer code contents, and injected clock for recency", () => {
  const web = buildExaSearchOptions("q", { kind: "web", maxResults: 50, recency: "week" }, new Date("2026-01-08T00:00:00.000Z"));
  assert.equal(web.numResults, 10);
  assert.equal(web.startPublishedDate, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(web.contents, { highlights: { query: "q", maxCharacters: 500 } });

  const code = buildExaSearchOptions("q", { kind: "code", maxCharacters: 30_000 });
  assert.equal(Boolean(code.systemPrompt?.includes("official documentation")), true);
  assert.deepEqual(code.contents, {
    highlights: { query: "q", maxCharacters: 1_000 },
    text: { maxCharacters: 2_000 },
  });
});

test("normalizeQueries rejects empty and caps query count", () => {
  assert.deepEqual(normalizeQueries({ query: " a ", queries: ["b", "a"] }), ["a", "b"]);
  assert.throws(() => normalizeQueries({}), /requires query/);
  assert.throws(() => normalizeQueries({ queries: ["1", "2", "3", "4", "5"] }), /at most 4/);
});

test("ExaSearchProvider does not allow provider calls without a key", async () => {
  const provider = new ExaSearchProvider({ apiKey: "" });
  await assert.rejects(() => provider.search("q"), MissingProviderKeyError);
});

test("searchWithCache normalizes domain filters in cache keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-access-exa-domains-test-"));
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  let calls = 0;
  const provider = {
    async search(query: string) {
      calls += 1;
      return normalizeExaSearchResponse(rawExaResponse, {
        query,
        searchedAt: "2026-01-01T00:00:00.000Z",
      });
    },
  };

  try {
    await searchWithCache({
      cache,
      provider,
      query: "docs",
      options: { kind: "web", provider: "exa", includeDomains: [" Example.com", "a.com", "example.com"] },
      ttlHours: 24,
    });
    const second = await searchWithCache({
      cache,
      provider,
      query: "docs",
      options: { kind: "web", provider: "exa", includeDomains: ["a.com", "example.com"] },
      ttlHours: 24,
    });

    assert.equal(calls, 1);
    assert.equal(second.cacheHit, true);
  } finally {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searchWithCache avoids repeated provider calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-access-exa-test-"));
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  let calls = 0;
  const provider = {
    async search(query: string) {
      calls += 1;
      return normalizeExaSearchResponse(rawExaResponse, {
        query,
        searchedAt: "2026-01-01T00:00:00.000Z",
      });
    },
  };

  try {
    const first = await searchWithCache({
      cache,
      provider,
      query: "docs",
      options: { kind: "web", provider: "exa", maxResults: 5 },
      ttlHours: 24,
    });
    const second = await searchWithCache({
      cache,
      provider,
      query: "docs",
      options: { kind: "web", provider: "exa", maxResults: 5 },
      ttlHours: 24,
    });

    assert.equal(calls, 1);
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
  } finally {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
