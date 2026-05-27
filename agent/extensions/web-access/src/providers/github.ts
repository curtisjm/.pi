import { execFile as execFileCallback } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { DEFAULT_WEB_ACCESS_TTLS, WEB_ACCESS_CACHE_DB_PATH } from "../config.ts";
import type { GitHubProvider, GitHubRoute, PageContent, FetchOptions, PageFetcher, WebAccessConfig } from "../types.ts";
import type { WebAccessCache } from "../cache.ts";
import { checkExecutable } from "../config.ts";
import { conciseError } from "../utils/errors.ts";
import { contentHash, makeCacheKey } from "../utils/hash.ts";
import { assertPublicHttpUrl, isNoisyRepoPath, parseGitHubUrl, type ResolveHostname } from "../utils/urls.ts";

export { parseGitHubUrl } from "../utils/urls.ts";

const execFile = promisify(execFileCallback);
const DEFAULT_GITHUB_CACHE_ROOT = join(dirname(WEB_ACCESS_CACHE_DB_PATH), "github");
const TEXT_PREVIEW_CHARS = 20_000;
const README_PREVIEW_CHARS = 12_000;
const TREE_ENTRY_LIMIT = 250;
const COMMENT_LIMIT = 25;
const COMMENT_TOTAL_CHARS = 20_000;

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export type ExecFileImpl = (file: string, args: string[], options?: { cwd?: string; timeout?: number }) => Promise<ExecFileResult>;

export interface GitHubContentProviderOptions {
  cache: WebAccessCache;
  config?: WebAccessConfig;
  cacheRoot?: string;
  execFileImpl?: ExecFileImpl;
  fetchImpl?: typeof fetch;
  resolveHostname?: ResolveHostname;
  firecrawlFallback?: PageFetcher;
  now?: () => Date;
}

interface GitHubApiIssue {
  number: number;
  title: string;
  state: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | string>;
  created_at?: string;
  updated_at?: string;
  body?: string | null;
  comments?: unknown[];
  html_url?: string;
}

interface GitHubApiPr extends GitHubApiIssue {
  additions?: number;
  deletions?: number;
  changed_files?: number;
  merged?: boolean;
}

export class GitHubContentProvider implements GitHubProvider {
  private readonly cache: WebAccessCache;
  private readonly config: WebAccessConfig;
  private readonly cacheRoot: string;
  private readonly execFileImpl: ExecFileImpl;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHostname?: ResolveHostname;
  private readonly firecrawlFallback?: PageFetcher;
  private readonly now: () => Date;

  constructor(options: GitHubContentProviderOptions) {
    this.cache = options.cache;
    this.config = options.config ?? {
      envPath: join(homedir(), ".pi", "agent", ".env"),
      cacheDbPath: WEB_ACCESS_CACHE_DB_PATH,
      keys: { exa: "missing", firecrawl: "missing", githubToken: process.env.GITHUB_TOKEN?.trim() ? "present" : "missing" },
      ttls: DEFAULT_WEB_ACCESS_TTLS,
    };
    this.cacheRoot = options.cacheRoot ?? DEFAULT_GITHUB_CACHE_ROOT;
    this.execFileImpl = options.execFileImpl ?? defaultExecFile;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHostname = options.resolveHostname;
    this.firecrawlFallback = options.firecrawlFallback;
    this.now = options.now ?? (() => new Date());
  }

  canHandle(url: string): GitHubRoute | null {
    return parseGitHubUrl(url);
  }

  async fetchGitHub(url: string, options: FetchOptions = {}): Promise<PageContent> {
    const route = parseGitHubUrl(url);
    if (!route) throw new Error(`Unsupported GitHub URL: ${url}`);

    if (route.kind === "repo" || route.kind === "tree" || route.kind === "blob") {
      return this.fetchCodeRoute(url, route, options);
    }

    if (route.kind === "issue" || route.kind === "pull") {
      return this.fetchIssueOrPull(url, route, options);
    }

    throw new Error(`Unsupported GitHub route kind: ${route.kind}`);
  }

  private async fetchCodeRoute(url: string, route: GitHubRoute, options: FetchOptions): Promise<PageContent> {
    const clone = await this.ensureClone(route, options);
    const markdown = await renderCodeRouteMarkdown(clone.localPath, route);
    return {
      url,
      title: `${route.owner}/${route.repo}${route.path ? `/${route.path}` : ""}`,
      markdown,
      source: "github-clone",
      fetchedAt: this.now().toISOString(),
      contentHash: contentHash(markdown),
      metadata: {
        owner: route.owner,
        repo: route.repo,
        ref: route.ref,
        path: route.path,
        localPath: clone.localPath,
        routeKind: route.kind,
      },
    };
  }

  private async ensureClone(route: GitHubRoute, options: FetchOptions) {
    const ref = route.ref;
    const cloneKey = makeCacheKey("github-clone", { schema: 1, owner: route.owner, repo: route.repo, ref: ref ?? "default" });
    const cached = this.cache.getGitHubClone(cloneKey, { forceRefresh: options.forceRefresh });
    if (cached && existsSync(cached.localPath)) return cached;

    const target = githubClonePath(this.cacheRoot, route.owner, route.repo, ref);
    if (options.forceRefresh || !existsSync(target)) {
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await cloneRepository({
        owner: route.owner,
        repo: route.repo,
        ref,
        target,
        execFileImpl: this.execFileImpl,
        resolveHostname: this.resolveHostname,
      });
    }

    const ttlHours = ref && isCommitSha(ref) ? this.config.ttls.githubCommitCloneTtlHours : this.config.ttls.githubBranchCloneTtlHours;
    return this.cache.setGitHubClone({
      cacheKey: cloneKey,
      owner: route.owner,
      repo: route.repo,
      ref,
      localPath: target,
      ttlHours,
      metadata: { clonedBy: checkExecutable("gh") === "available" ? "gh-or-git" : "git" },
    });
  }

  private async fetchIssueOrPull(url: string, route: GitHubRoute, options: FetchOptions): Promise<PageContent> {
    const attempts: string[] = [];

    try {
      const page = await this.fetchIssueOrPullViaGh(url, route);
      if (page) return page;
      attempts.push("gh CLI returned no result");
    } catch (error) {
      attempts.push(`gh CLI: ${conciseError(error)}`);
    }

    try {
      return await this.fetchIssueOrPullViaRest(url, route, options.timeoutMs ?? 30_000);
    } catch (error) {
      attempts.push(`GitHub REST: ${conciseError(error)}`);
    }

    if (this.firecrawlFallback) {
      try {
        return await this.firecrawlFallback.fetchPage(url, options);
      } catch (error) {
        attempts.push(`Firecrawl fallback: ${conciseError(error)}`);
      }
    }

    throw new Error(`GitHub structured access failed for ${url}. ${attempts.join(" | ")}`);
  }

  private async fetchIssueOrPullViaGh(url: string, route: GitHubRoute): Promise<PageContent | null> {
    await assertPublicHttpUrl(url, this.resolveHostname);
    if (checkExecutable("gh") !== "available") return null;
    const repoArg = `${route.owner}/${route.repo}`;
    const number = String(route.number);
    const jsonFields =
      route.kind === "pull"
        ? "title,state,author,labels,createdAt,updatedAt,body,comments,reviews,files,url"
        : "title,state,author,labels,createdAt,updatedAt,body,comments,url";
    const args = [route.kind === "pull" ? "pr" : "issue", "view", number, "--repo", repoArg, "--json", jsonFields];
    const { stdout } = await this.execFileImpl("gh", args, { timeout: 30_000 });
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    const markdown = route.kind === "pull" ? formatGhPrMarkdown(route, payload) : formatGhIssueMarkdown(route, payload);
    return {
      url,
      title: typeof payload.title === "string" ? payload.title : `${repoArg}#${number}`,
      markdown,
      source: "github-gh",
      fetchedAt: this.now().toISOString(),
      contentHash: contentHash(markdown),
      metadata: { owner: route.owner, repo: route.repo, number: route.number, routeKind: route.kind },
    };
  }

  private async fetchIssueOrPullViaRest(url: string, route: GitHubRoute, timeoutMs: number): Promise<PageContent> {
    const repoApi = `https://api.github.com/repos/${route.owner}/${route.repo}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pi-web-access/1.0 (+https://github.com/curtisjm/.pi)",
    };
    if (process.env.GITHUB_TOKEN?.trim()) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;

    const issue = (await fetchJson(this.fetchImpl, `${repoApi}/issues/${route.number}`, headers, timeoutMs, this.resolveHostname)) as GitHubApiIssue;
    const comments = (await fetchJson(this.fetchImpl, `${repoApi}/issues/${route.number}/comments?per_page=100`, headers, timeoutMs, this.resolveHostname)) as unknown[];

    if (route.kind === "pull") {
      const [pr, reviews, files] = await Promise.all([
        fetchJson(this.fetchImpl, `${repoApi}/pulls/${route.number}`, headers, timeoutMs, this.resolveHostname) as Promise<GitHubApiPr>,
        fetchJson(this.fetchImpl, `${repoApi}/pulls/${route.number}/reviews?per_page=100`, headers, timeoutMs, this.resolveHostname) as Promise<unknown[]>,
        fetchJson(this.fetchImpl, `${repoApi}/pulls/${route.number}/files?per_page=100`, headers, timeoutMs, this.resolveHostname) as Promise<unknown[]>,
      ]);
      const markdown = formatRestPrMarkdown(route, issue, pr, comments, reviews, files);
      return {
        url,
        title: issue.title,
        markdown,
        source: "github-api",
        fetchedAt: this.now().toISOString(),
        contentHash: contentHash(markdown),
        metadata: { owner: route.owner, repo: route.repo, number: route.number, routeKind: route.kind },
      };
    }

    const markdown = formatRestIssueMarkdown(route, issue, comments);
    return {
      url,
      title: issue.title,
      markdown,
      source: "github-api",
      fetchedAt: this.now().toISOString(),
      contentHash: contentHash(markdown),
      metadata: { owner: route.owner, repo: route.repo, number: route.number, routeKind: route.kind },
    };
  }
}

export class GitHubUrlProvider extends GitHubContentProvider {}

export async function cloneRepository(args: {
  owner: string;
  repo: string;
  ref?: string;
  target: string;
  execFileImpl?: ExecFileImpl;
  resolveHostname?: ResolveHostname;
}): Promise<void> {
  const execImpl = args.execFileImpl ?? defaultExecFile;
  const repoSlug = `${args.owner}/${args.repo}`;
  const ref = args.ref;
  await assertPublicHttpUrl(`https://github.com/${repoSlug}`, args.resolveHostname);

  if (ref && isCommitSha(ref)) {
    await execImpl("git", ["clone", "--no-checkout", "--depth", "1", `https://github.com/${repoSlug}.git`, args.target], { timeout: 120_000 });
    await execImpl("git", ["-C", args.target, "fetch", "--depth", "1", "origin", ref], { timeout: 120_000 });
    await execImpl("git", ["-C", args.target, "checkout", "--detach", ref], { timeout: 60_000 });
    return;
  }

  const branchArgs = ref ? ["--branch", ref] : [];
  if (checkExecutable("gh") === "available") {
    try {
      await execImpl("gh", ["repo", "clone", repoSlug, args.target, "--", "--depth", "1", "--single-branch", ...branchArgs], {
        timeout: 120_000,
      });
      return;
    } catch {
      await rm(args.target, { recursive: true, force: true });
      await mkdir(dirname(args.target), { recursive: true });
    }
  }

  await execImpl("git", ["clone", "--depth", "1", "--single-branch", ...branchArgs, `https://github.com/${repoSlug}.git`, args.target], {
    timeout: 120_000,
  });
}

export function githubClonePath(cacheRoot: string, owner: string, repo: string, ref?: string): string {
  const suffix = ref ? `@${safePathSegment(ref)}` : "@default";
  return join(cacheRoot, safePathSegment(owner), `${safePathSegment(repo)}${suffix}`);
}

export async function renderCodeRouteMarkdown(localRepoPath: string, route: GitHubRoute): Promise<string> {
  if (route.kind === "blob") {
    const filePath = safeResolveInRepo(localRepoPath, route.path ?? "");
    return renderBlobMarkdown(filePath, localRepoPath, route);
  }

  const dirPath = route.kind === "tree" && route.path ? safeResolveInRepo(localRepoPath, route.path) : localRepoPath;
  const entries = await listRepoTree(dirPath, localRepoPath, TREE_ENTRY_LIMIT);
  const readme = await findReadmePreview(dirPath);
  return [
    `# GitHub ${route.kind === "tree" ? "tree" : "repository"}: ${route.owner}/${route.repo}`,
    route.ref ? `Ref: ${route.ref}` : undefined,
    route.path ? `Path: ${route.path}` : undefined,
    `Local path: ${dirPath}`,
    "",
    "## Directory listing",
    entries.join("\n") || "(empty)",
    readme ? `\n## README preview\n${readme}` : undefined,
    "",
    "Use built-in read/bash tools on the local path above for more repo exploration. Do not execute untrusted code from cloned repositories.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function renderBlobMarkdown(filePath: string, localRepoPath: string, route: GitHubRoute): Promise<string> {
  const rel = relative(localRepoPath, filePath);
  const data = await readFile(filePath);
  const binary = isBinaryBuffer(data) || isBinaryPath(filePath);
  if (binary) {
    return [
      `# GitHub blob: ${route.owner}/${route.repo}/${route.path ?? rel}`,
      route.ref ? `Ref: ${route.ref}` : undefined,
      `Local path: ${filePath}`,
      "",
      "Binary file detected; inline content omitted.",
      "Use built-in tools on the local path if you need file metadata.",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }

  const text = data.toString("utf8");
  return [
    `# GitHub blob: ${route.owner}/${route.repo}/${route.path ?? rel}`,
    route.ref ? `Ref: ${route.ref}` : undefined,
    `Local path: ${filePath}`,
    "",
    text,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function safeResolveInRepo(localRepoPath: string, repoRelativePath: string): string {
  const base = resolve(localRepoPath);
  const target = resolve(base, repoRelativePath);
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Refusing to read outside cloned repository");
  }

  const baseReal = realpathSync(base);
  const targetReal = realpathSync(target);
  if (targetReal !== baseReal && !targetReal.startsWith(`${baseReal}${sep}`)) {
    throw new Error("Refusing to read outside cloned repository");
  }

  return targetReal;
}

export function formatGhIssueMarkdown(route: GitHubRoute, issue: Record<string, unknown>): string {
  return formatIssueMarkdown({
    heading: `# ${route.owner}/${route.repo} issue #${route.number}: ${stringField(issue.title)}`,
    state: stringField(issue.state),
    author: nestedLogin(issue.author),
    labels: labelNames(issue.labels),
    createdAt: stringField(issue.createdAt),
    updatedAt: stringField(issue.updatedAt),
    body: stringField(issue.body),
    comments: arrayField(issue.comments),
  });
}

export function formatGhPrMarkdown(route: GitHubRoute, pr: Record<string, unknown>): string {
  return formatPrMarkdown({
    heading: `# ${route.owner}/${route.repo} PR #${route.number}: ${stringField(pr.title)}`,
    state: stringField(pr.state),
    author: nestedLogin(pr.author),
    labels: labelNames(pr.labels),
    createdAt: stringField(pr.createdAt),
    updatedAt: stringField(pr.updatedAt),
    body: stringField(pr.body),
    comments: arrayField(pr.comments),
    reviews: arrayField(pr.reviews),
    files: arrayField(pr.files),
  });
}

export function formatRestIssueMarkdown(route: GitHubRoute, issue: GitHubApiIssue, comments: unknown[]): string {
  return formatIssueMarkdown({
    heading: `# ${route.owner}/${route.repo} issue #${route.number}: ${issue.title}`,
    state: issue.state,
    author: issue.user?.login,
    labels: labelNames(issue.labels),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    body: issue.body ?? "",
    comments,
  });
}

export function formatRestPrMarkdown(
  route: GitHubRoute,
  issue: GitHubApiIssue,
  pr: GitHubApiPr,
  comments: unknown[],
  reviews: unknown[],
  files: unknown[],
): string {
  return formatPrMarkdown({
    heading: `# ${route.owner}/${route.repo} PR #${route.number}: ${issue.title}`,
    state: issue.state,
    author: issue.user?.login,
    labels: labelNames(issue.labels),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    body: issue.body ?? "",
    comments,
    reviews,
    files,
    summary: `Changed files: ${pr.changed_files ?? "unknown"}; additions: ${pr.additions ?? "unknown"}; deletions: ${pr.deletions ?? "unknown"}; merged: ${pr.merged ?? "unknown"}`,
  });
}

async function listRepoTree(dirPath: string, repoRoot: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (out.length >= limit || depth > 3) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) break;
      const full = join(current, entry.name);
      const rel = relative(repoRoot, full);
      if (!rel || isNoisyRepoPath(rel)) continue;
      out.push(`${entry.isDirectory() ? "dir " : "file"} ${rel}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(dirPath, 0);
  if (out.length >= limit) out.push(`... listing capped at ${limit} entries`);
  return out;
}

async function findReadmePreview(dirPath: string): Promise<string | null> {
  const entries = await readdir(dirPath).catch(() => []);
  const readme = entries.find((name) => /^readme\.(md|mdx|txt|rst)$/i.test(name)) ?? entries.find((name) => /^readme$/i.test(name));
  if (!readme) return null;
  const path = join(dirPath, readme);
  if ((await stat(path)).isDirectory()) return null;
  const data = await readFile(path);
  if (isBinaryBuffer(data)) return null;
  const text = data.toString("utf8");
  return text.length <= README_PREVIEW_CHARS
    ? text
    : `${text.slice(0, README_PREVIEW_CHARS)}\n\n[README preview capped at ${README_PREVIEW_CHARS} chars. Use read on ${path} for full content.]`;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs = 30_000,
  resolveHostname?: ResolveHostname,
): Promise<unknown> {
  await assertPublicHttpUrl(url, resolveHostname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub REST failed with ${response.status} ${response.statusText}`.trim());
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function formatIssueMarkdown(args: {
  heading: string;
  state?: string;
  author?: string;
  labels: string[];
  createdAt?: string;
  updatedAt?: string;
  body?: string;
  comments: unknown[];
}): string {
  return [
    args.heading,
    `State: ${args.state ?? "unknown"}`,
    `Author: ${args.author ?? "unknown"}`,
    args.labels.length ? `Labels: ${args.labels.join(", ")}` : "Labels: none",
    args.createdAt ? `Created: ${args.createdAt}` : undefined,
    args.updatedAt ? `Updated: ${args.updatedAt}` : undefined,
    "",
    "## Body",
    capSection(args.body ?? "", 12_000),
    "",
    "## Comments",
    formatDiscussion(args.comments),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatPrMarkdown(args: {
  heading: string;
  state?: string;
  author?: string;
  labels: string[];
  createdAt?: string;
  updatedAt?: string;
  body?: string;
  comments: unknown[];
  reviews: unknown[];
  files: unknown[];
  summary?: string;
}): string {
  return [
    args.heading,
    `State: ${args.state ?? "unknown"}`,
    `Author: ${args.author ?? "unknown"}`,
    args.labels.length ? `Labels: ${args.labels.join(", ")}` : "Labels: none",
    args.createdAt ? `Created: ${args.createdAt}` : undefined,
    args.updatedAt ? `Updated: ${args.updatedAt}` : undefined,
    args.summary,
    "",
    "## Body",
    capSection(args.body ?? "", 12_000),
    "",
    "## Changed files summary",
    formatFiles(args.files),
    "",
    "## Comments",
    formatDiscussion(args.comments),
    "",
    "## Reviews",
    formatDiscussion(args.reviews),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function formatDiscussion(items: unknown[]): string {
  if (items.length === 0) return "(none)";
  let used = 0;
  const lines: string[] = [];
  for (const [index, item] of items.slice(0, COMMENT_LIMIT).entries()) {
    const record = isRecord(item) ? item : {};
    const author = nestedLogin(record.author) ?? nestedLogin(record.user) ?? "unknown";
    const created = stringField(record.createdAt) ?? stringField(record.created_at) ?? stringField(record.submittedAt) ?? stringField(record.submitted_at);
    const state = stringField(record.state);
    const body = stringField(record.body) ?? "";
    const capped = capSection(body, Math.max(0, COMMENT_TOTAL_CHARS - used));
    used += capped.length;
    lines.push(`### ${index + 1}. ${author}${state ? ` (${state})` : ""}${created ? ` at ${created}` : ""}`);
    lines.push(capped || "(empty)");
    if (used >= COMMENT_TOTAL_CHARS) {
      lines.push(`[Discussion capped at ${COMMENT_TOTAL_CHARS} chars.]`);
      break;
    }
  }
  if (items.length > COMMENT_LIMIT) lines.push(`[${items.length - COMMENT_LIMIT} additional discussion item(s) omitted.]`);
  return lines.join("\n\n");
}

function formatFiles(files: unknown[]): string {
  if (files.length === 0) return "(none)";
  return files
    .slice(0, 100)
    .map((file) => {
      const record = isRecord(file) ? file : {};
      const filename = stringField(record.filename) ?? stringField(record.path) ?? "unknown";
      const status = stringField(record.status) ?? "modified";
      const additions = numberField(record.additions);
      const deletions = numberField(record.deletions);
      const changes = numberField(record.changes);
      return `- ${filename} (${status}; +${additions ?? "?"}/-${deletions ?? "?"}, changes ${changes ?? "?"})`;
    })
    .join("\n");
}

function capSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Section capped at ${maxChars} chars.]`;
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === "string" ? label : isRecord(label) && typeof label.name === "string" ? label.name : undefined))
    .filter((label): label is string => Boolean(label));
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function nestedLogin(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.login === "string") return value.login;
  if (isRecord(value.user) && typeof value.user.login === "string") return value.user.login;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isCommitSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160) || "_";
}

function isBinaryPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|pdf|zip|gz|tar|tgz|mp4|mov|avi|dmg|ico|woff2?|ttf|otf)$/i.test(path);
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0);
}

async function defaultExecFile(file: string, args: string[], options: { cwd?: string; timeout?: number } = {}): Promise<ExecFileResult> {
  return execFile(file, args, { cwd: options.cwd, timeout: options.timeout ?? 120_000, maxBuffer: 10 * 1024 * 1024 });
}
