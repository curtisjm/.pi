import assert from "node:assert/strict";
import test from "node:test";

import { DirectHttpFetcher, DIRECT_HTTP_MAX_BYTES } from "../src/providers/direct-http.ts";
import { WebRouter } from "../src/router.ts";
import { DirectFetchRejectedError } from "../src/utils/errors.ts";
import {
  isDirectFetchContentType,
  isDirectFetchUrlCandidate,
  normalizeUrl,
  parseGitHubUrl,
  type ResolveHostname,
  assertPublicHttpUrl,
} from "../src/utils/urls.ts";

const publicResolver: ResolveHostname = async () => [{ address: "93.184.216.34", family: 4 }];

test("GitHub URL parser classifies repo/blob/tree/issue/pull and rejects non-code pages", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo"), {
    kind: "repo",
    owner: "owner",
    repo: "repo",
  });

  const blob = parseGitHubUrl("https://github.com/owner/repo/blob/main/src/index.ts");
  assert.equal(blob?.kind, "blob");
  assert.equal(blob?.owner, "owner");
  assert.equal(blob?.repo, "repo");
  assert.equal(blob?.ref, "main");
  assert.equal(blob?.path, "src/index.ts");

  const tree = parseGitHubUrl("https://github.com/owner/repo/tree/develop/packages/pkg");
  assert.equal(tree?.kind, "tree");
  assert.equal(tree?.ref, "develop");
  assert.equal(tree?.path, "packages/pkg");

  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo/issues/14"), {
    kind: "issue",
    owner: "owner",
    repo: "repo",
    number: 14,
  });
  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo/pull/7"), {
    kind: "pull",
    owner: "owner",
    repo: "repo",
    number: 7,
  });

  assert.equal(parseGitHubUrl("https://github.com/owner/repo/actions"), null);
  assert.equal(parseGitHubUrl("https://github.com/owner/repo/blob/main/../secret"), null);
});

test("normalizeUrl blocks private and localhost targets", () => {
  assert.throws(() => normalizeUrl("http://localhost/"), /Blocked URL/);
  assert.throws(() => normalizeUrl("http://service.local/"), /Blocked URL/);
  assert.throws(() => normalizeUrl("http://intranet/"), /Blocked URL/);
  assert.throws(() => normalizeUrl("http://127.0.0.1/"), /Blocked URL/);
  assert.throws(() => normalizeUrl("http://10.0.0.5/"), /Blocked URL/);
  assert.throws(() => normalizeUrl("http://[::1]/"), /Blocked URL/);
  assert.equal(normalizeUrl("https://example.com/path#fragment"), "https://example.com/path");
});

test("assertPublicHttpUrl rejects hostnames that resolve to private addresses", async () => {
  await assert.rejects(
    () => assertPublicHttpUrl("https://example.com", async () => [{ address: "10.0.0.1", family: 4 }]),
    /Blocked URL/,
  );
  await assert.rejects(
    () => assertPublicHttpUrl("https://example.com", async () => [{ address: "fc00::1", family: 6 }]),
    /Blocked URL/,
  );
  await assert.rejects(
    () => assertPublicHttpUrl("https://example.com", async () => [{ address: "::ffff:127.0.0.1", family: 6 }]),
    /Blocked URL/,
  );
  await assert.doesNotReject(() => assertPublicHttpUrl("https://example.com", publicResolver));
});

test("direct fetch eligibility is conservative", () => {
  assert.equal(isDirectFetchUrlCandidate("https://raw.githubusercontent.com/o/r/main/README.md"), true);
  assert.equal(isDirectFetchUrlCandidate("https://example.com/llms.txt"), true);
  assert.equal(isDirectFetchUrlCandidate("https://example.com/data.json"), true);
  assert.equal(isDirectFetchUrlCandidate("https://example.com/blog/post"), false);

  assert.equal(isDirectFetchContentType("text/plain; charset=utf-8"), true);
  assert.equal(isDirectFetchContentType("application/json"), true);
  assert.equal(isDirectFetchContentType("text/html; charset=utf-8"), false);
});

test("router chooses GitHub/direct/Firecrawl routes", () => {
  const router = new WebRouter();
  assert.equal(router.route("https://github.com/o/r/blob/main/README.md").kind, "github");
  assert.equal(router.route("https://github.com/o/r/issues/1").kind, "github");
  assert.equal(router.route("https://raw.githubusercontent.com/o/r/main/README.md").kind, "direct-http");
  assert.equal(router.route("https://example.com/blog/post").kind, "firecrawl");
  assert.equal(router.route("https://example.com/blog/post", { fetchMode: "direct" }).kind, "direct-http");
  assert.throws(() => router.route("https://example.com", { fetchMode: "github" }), /only supports GitHub/);
});

test("direct fetch returns static text in auto mode", async () => {
  const fetcher = new DirectHttpFetcher({
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    resolveHostname: publicResolver,
    fetchImpl: async () =>
      new Response("# Hello", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
  });

  const page = await fetcher.fetchPage("https://example.com/llms.txt");
  assert.equal(page.source, "direct-http");
  assert.equal(page.markdown, "# Hello");
  assert.equal(page.title, "llms.txt");
});

test("direct fetch rejects responses above byte cap before reading", async () => {
  const fetcher = new DirectHttpFetcher({
    resolveHostname: publicResolver,
    fetchImpl: async () =>
      new Response("small", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(DIRECT_HTTP_MAX_BYTES + 1) },
      }),
  });

  await assert.rejects(() => fetcher.fetchPage("https://example.com/large.txt", { fetchMode: "auto" }), /byte limit/);
});

test("direct fetch rejects streaming responses above byte cap", async () => {
  const fetcher = new DirectHttpFetcher({
    resolveHostname: publicResolver,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(DIRECT_HTTP_MAX_BYTES + 1));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/plain" },
        },
      ),
  });

  await assert.rejects(() => fetcher.fetchPage("https://example.com/large.txt", { fetchMode: "auto" }), /byte limit/);
});

test("direct fetch rejects HTML in auto mode without exposing raw HTML", async () => {
  const fetcher = new DirectHttpFetcher({
    resolveHostname: publicResolver,
    fetchImpl: async () =>
      new Response("<html><body>messy</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  await assert.rejects(
    () => fetcher.fetchPage("https://example.com/page", { fetchMode: "auto" }),
    (error) => error instanceof DirectFetchRejectedError && !String(error.message).includes("<html>"),
  );
});
