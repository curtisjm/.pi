import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WebAccessCache } from "../src/cache.ts";
import type { ResolveHostname } from "../src/utils/urls.ts";
import {
  GitHubContentProvider,
  formatGhIssueMarkdown,
  formatGhPrMarkdown,
  githubClonePath,
  renderCodeRouteMarkdown,
  safeResolveInRepo,
} from "../src/providers/github.ts";

const publicResolver: ResolveHostname = async () => [{ address: "140.82.114.4", family: 4 }];

test("githubClonePath sanitizes ref for local cache path", () => {
  const path = githubClonePath("/cache", "owner", "repo", "feature/one two");
  assert.equal(path, join("/cache", "owner", "repo@feature_one_two"));
});

test("safeResolveInRepo prevents lexical and symlink path traversal", async () => {
  const parent = await mkdtemp(join(tmpdir(), "web-access-github-safe-"));
  const root = join(parent, "repo");
  const outside = join(parent, "outside.txt");
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const x = 1;");
    writeFileSync(outside, "secret");
    symlinkSync(outside, join(root, "src", "outside-link"));

    assert.equal(safeResolveInRepo(root, "src/index.ts"), realpathSync(join(root, "src", "index.ts")));
    assert.throws(() => safeResolveInRepo(root, "../outside.txt"), /outside cloned repository/);
    assert.throws(() => safeResolveInRepo(root, "src/outside-link"), /outside cloned repository/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("formatGhIssueMarkdown caps discussion and includes metadata", () => {
  const markdown = formatGhIssueMarkdown(
    { kind: "issue", owner: "o", repo: "r", number: 14 },
    {
      title: "Bug",
      state: "OPEN",
      author: { login: "curtis" },
      labels: [{ name: "bug" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      body: "Body",
      comments: [{ author: { login: "alice" }, body: "Comment" }],
    },
  );

  assert.match(markdown, /o\/r issue #14: Bug/);
  assert.match(markdown, /Labels: bug/);
  assert.match(markdown, /alice/);
  assert.match(markdown, /Comment/);
});

test("formatGhPrMarkdown includes changed-file summaries without diffs", () => {
  const markdown = formatGhPrMarkdown(
    { kind: "pull", owner: "o", repo: "r", number: 7 },
    {
      title: "Feature",
      state: "MERGED",
      author: { login: "curtis" },
      labels: [],
      body: "Body",
      comments: [],
      reviews: [{ author: { login: "reviewer" }, state: "APPROVED", body: "LGTM" }],
      files: [{ path: "src/index.ts", status: "modified", additions: 2, deletions: 1, changes: 3, patch: "SHOULD NOT APPEAR" }],
    },
  );

  assert.match(markdown, /PR #7: Feature/);
  assert.match(markdown, /src\/index.ts/);
  assert.doesNotMatch(markdown, /SHOULD NOT APPEAR/);
  assert.match(markdown, /reviewer/);
});

test("GitHub REST issue fetch passes AbortSignal timeout to fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-access-github-rest-"));
  const cache = new WebAccessCache({ dbPath: join(dir, "cache.sqlite") });
  const observedSignals: Array<AbortSignal | null | undefined> = [];
  try {
    const provider = new GitHubContentProvider({
      cache,
      execFileImpl: async () => {
        throw new Error("gh unavailable in test");
      },
      resolveHostname: publicResolver,
      fetchImpl: async (url, init) => {
        observedSignals.push(init?.signal);
        const body = String(url).includes("/comments")
          ? []
          : { title: "Issue", state: "open", user: { login: "curtis" }, labels: [], body: "Body" };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const page = await provider.fetchGitHub("https://github.com/o/r/issues/1", { timeoutMs: 123 });
    assert.equal(page.source, "github-api");
    assert.equal(observedSignals.length, 2);
    assert.equal(observedSignals.every((signal) => signal instanceof AbortSignal), true);
  } finally {
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderCodeRouteMarkdown lists repo tree and README preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "web-access-github-render-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "README.md"), "# Readme");
    writeFileSync(join(root, "src", "index.ts"), "export const x = 1;");

    const markdown = await renderCodeRouteMarkdown(root, { kind: "repo", owner: "o", repo: "r" });
    assert.match(markdown, /Local path:/);
    assert.match(markdown, /file README.md/);
    assert.match(markdown, /file src\/index.ts/);
    assert.match(markdown, /# Readme/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
