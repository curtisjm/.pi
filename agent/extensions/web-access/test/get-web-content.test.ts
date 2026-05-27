import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebAccessCache } from "../src/cache.ts";
import { getStoredWebContent, selectStoredContent } from "../src/tools/get-web-content-core.ts";
import type { SearchResponsePayload } from "../src/tools/search-core.ts";
import type { WebFetchResponsePayload } from "../src/tools/web-fetch-core.ts";

test("getStoredWebContent returns capped page chunks with exact follow-up calls", () => {
  const { cache, cleanup } = makeTempCache();
  try {
    const stored = cache.createResponse<WebFetchResponsePayload>(
      "web_fetch",
      {
        kind: "web_fetch",
        createdAt: "2026-01-01T00:00:00.000Z",
        pages: [
          {
            url: "https://example.com/a",
            title: "A",
            markdown: "abcdef",
            source: "firecrawl",
            fetchedAt: "2026-01-01T00:00:00.000Z",
            contentHash: "hash",
          },
        ],
      },
      24,
    );

    const text = getStoredWebContent(cache, { responseId: stored.responseId, maxChars: 3 });
    assert.match(text, /chars 0-3 of 6/);
    assert.match(text, /abc/);
    assert.match(text, new RegExp(`get_web_content\\(\\{ responseId: "${stored.responseId}", urlIndex: 0, offset: 3`));
    assert.match(text, /full: true/);
  } finally {
    cleanup();
  }
});

test("getStoredWebContent treats fractional maxChars below 1 as default", () => {
  const { cache, cleanup } = makeTempCache();
  try {
    const stored = cache.createResponse<WebFetchResponsePayload>(
      "web_fetch",
      {
        kind: "web_fetch",
        createdAt: "2026-01-01T00:00:00.000Z",
        pages: [
          {
            url: "https://example.com/a",
            title: "A",
            markdown: "abcdef",
            source: "firecrawl",
            fetchedAt: "2026-01-01T00:00:00.000Z",
            contentHash: "hash",
          },
        ],
      },
      24,
    );

    const text = getStoredWebContent(cache, { responseId: stored.responseId, maxChars: 0.5 });
    assert.match(text, /chars 0-6 of 6/);
    assert.doesNotMatch(text, /chars 0-0 of 6/);
  } finally {
    cleanup();
  }
});

test("getStoredWebContent full true returns all selected content", () => {
  const { cache, cleanup } = makeTempCache();
  try {
    const stored = cache.createResponse<WebFetchResponsePayload>(
      "web_fetch",
      {
        kind: "web_fetch",
        createdAt: "2026-01-01T00:00:00.000Z",
        pages: [
          {
            url: "https://example.com/a",
            title: "A",
            markdown: "abcdef",
            source: "firecrawl",
            fetchedAt: "2026-01-01T00:00:00.000Z",
            contentHash: "hash",
          },
        ],
      },
      24,
    );

    const text = getStoredWebContent(cache, { responseId: stored.responseId, full: true });
    assert.match(text, /Full content returned intentionally/);
    assert.match(text, /abcdef/);
  } finally {
    cleanup();
  }
});

test("selectStoredContent requires urlIndex for multi-page fetch responses", () => {
  const stored = {
    responseId: "id",
    kind: "web_fetch",
    createdAt: "now",
    expiresAt: null,
    payload: {
      kind: "web_fetch",
      createdAt: "now",
      pages: [
        { url: "https://a.test", title: null, markdown: "A", source: "firecrawl", fetchedAt: "now", contentHash: "a" },
        { url: "https://b.test", title: null, markdown: "B", source: "firecrawl", fetchedAt: "now", contentHash: "b" },
      ],
    },
  } as const;

  assert.throws(() => selectStoredContent(stored, { responseId: "id" }), /Specify urlIndex or url/);
  assert.equal(selectStoredContent(stored, { responseId: "id", urlIndex: 1 }).content, "B");
});

test("selectStoredContent retrieves selected search query", () => {
  const stored = {
    responseId: "id",
    kind: "code_search",
    createdAt: "now",
    expiresAt: null,
    payload: {
      kind: "code_search",
      createdAt: "now",
      content: "all",
      responses: [
        { query: "a", provider: "exa", searchedAt: "now", cacheHit: false, results: [] },
        { query: "b", provider: "exa", searchedAt: "now", cacheHit: false, results: [{ title: "B", url: "https://b.test", domain: "b.test" }] },
      ],
    } satisfies SearchResponsePayload,
  };

  const selected = selectStoredContent(stored, { responseId: "id", query: "b" });
  assert.match(selected.content, /Query: b/);
  assert.match(selected.content, /https:\/\/b.test/);
});

function makeTempCache() {
  const dir = mkdtempSync(join(tmpdir(), "web-access-content-test-"));
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  return {
    cache,
    cleanup() {
      cache.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
