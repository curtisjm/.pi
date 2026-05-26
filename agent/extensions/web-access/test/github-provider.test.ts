import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatGhIssueMarkdown,
  formatGhPrMarkdown,
  githubClonePath,
  renderCodeRouteMarkdown,
  safeResolveInRepo,
} from "../src/providers/github.ts";

test("githubClonePath sanitizes ref for local cache path", () => {
  const path = githubClonePath("/cache", "owner", "repo", "feature/one two");
  assert.equal(path, join("/cache", "owner", "repo@feature_one_two"));
});

test("safeResolveInRepo prevents path traversal", () => {
  const root = "/tmp/repo";
  assert.equal(safeResolveInRepo(root, "src/index.ts"), join(root, "src/index.ts"));
  assert.throws(() => safeResolveInRepo(root, "../secret"), /outside cloned repository/);
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
