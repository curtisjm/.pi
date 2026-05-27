# Focused Web Access Extension Spec

## Status

Original candidate implementation plan. The implementation has since been completed in this PR stack.

This document was intended to be sufficient context for a fresh Pi agent session to implement the extension. After this spec was reviewed and accepted, the durable decisions were promoted into:

```text
docs/decisions/0003-add-focused-web-access-extension.md
```

## Purpose

Add focused web search and fetch capability to this personal Pi coding-agent configuration without installing `pi-web-access` wholesale.

The extension should provide the web capabilities that are actually expected to be used:

- Exa for search/discovery/ranking.
- Exa for code/docs/example search.
- Firecrawl for clean page scraping when needed.
- Direct HTTP for cheap/static/agent-friendly sources.
- GitHub local cloning and GitHub metadata fetching to avoid scraping GitHub HTML when better structured access exists.
- Durable local caching to reduce repeat paid provider calls and keep context clean.

## Why global and local

This should be a **global personal Pi extension** tracked in this repo, not a project-local extension and not an installed third-party package.

Planned location:

```text
agent/extensions/web-access/
```

Rationale:

- Web search/fetch is useful across projects.
- This repo is the durable source of truth for personal Pi configuration.
- Local source ownership makes the extension auditable and easy to trim.
- The extension can improve on `pi-web-access` by being smaller, provider-focused, cache-first, and context-clean.

## Reference inspected

`pi-web-access` provides useful patterns but is intentionally broader than desired here. It includes:

- `web_search`
- `code_search`
- `fetch_content`
- `get_search_content`
- Exa, Perplexity, Gemini API, Gemini Web cookie access
- browser curator UI
- activity widget
- GitHub cloning
- PDF extraction
- YouTube/video handling
- Jina/Gemini fallbacks
- bundled `librarian` skill

This extension should borrow selected ideas only:

- GitHub code URLs should clone locally instead of scraping GitHub HTML.
- Search/fetch results should be stored behind response IDs.
- Full content retrieval should be explicit through a follow-up tool.
- Code search should have a separate intent-shaped tool.

This extension should **not** include in V1:

- Perplexity
- Gemini API or Gemini Web cookie access
- browser curator UI
- activity widget
- YouTube/video support
- PDF extraction beyond what Firecrawl/direct fetch naturally returns
- Jina fallback
- bundled skills
- GitHub cloning for non-code pages

## Finalized V1 decisions

1. Extension is global and local: `agent/extensions/web-access/`.
2. V1 tool surface:
   - `web_search`
   - `code_search`
   - `web_fetch`
   - `get_web_content`
3. Tool names are generic, not provider-specific.
4. Use official SDKs internally:
   - `exa-js`
   - `@mendable/firecrawl-js`
5. Do not expose SDK-specific types or response shapes outside provider adapters.
6. Use native `fetch` only inside a `DirectHttpFetcher` provider for cheap/static fallback paths.
7. Use `dotenv` for `.env` loading.
8. Use `zod` for startup env/config validation.
9. Env validation must be local only and must not call Exa, Firecrawl, or GitHub APIs.
10. API key validation is presence/non-empty only.
11. Missing keys are non-fatal at Pi startup; tools fail clearly when a missing provider is needed.
12. Secrets live in `agent/.env`; commit `agent/.env.example`.
13. Use agent-level pnpm package layout, not a package per extension.
14. Use SQLite via built-in `node:sqlite` for cache, not JSON files.
15. Cache path: `agent/cache/web-access/cache.sqlite`.
16. Cache both search results and fetched pages.
17. Default TTLs:
    - Exa search results: 24 hours
    - fetched pages: 7 days
    - GitHub branch clones: 24 hours
    - GitHub commit-SHA clones: effectively permanent or very long-lived
    - response records: 30 days
18. Add `forceRefresh` where appropriate to bypass cache.
19. Direct fetch should be conservative and avoid returning HTML by default.
20. Failed/messy direct fetch attempts must not be returned to the model, written to tool `details`, or cached.
21. Normal webpages route to Firecrawl in `auto` mode.
22. GitHub code URLs clone locally up front.
23. Only clone GitHub code URLs:
    - repo root
    - `/tree/...`
    - `/blob/...`
24. Do not clone GitHub issue/PR/discussion/wiki/release/action pages.
25. GitHub issue/PR URLs should use structured GitHub access before Firecrawl:
    - `gh` CLI when available/authenticated
    - GitHub REST with optional `GITHUB_TOKEN`
    - unauthenticated public REST
    - Firecrawl fallback only if structured access fails
26. GitHub issue/PR output includes capped metadata, discussion/reviews, and changed-file summaries; no full diffs by default.
27. GitHub clones persist in cache until TTL or `forceRefresh`.
28. Use `gh repo clone` when available, fallback to public `git clone`.
29. `web_search` supports `query` or `queries`, capped at 4 queries/call and 10 results/query.
30. `web_search` is compact discovery by default; full page content belongs in `web_fetch`.
31. `code_search` is single-query only.
32. `code_search` can return more content than `web_search`, but remains capped.
33. `web_fetch` supports one URL or multiple URLs, capped at 5 URLs/call.
34. `web_fetch` uses hybrid return:
    - single page: inline up to ~20k chars
    - multi-page/long content: compact summary + `responseId`
    - full content always stored in SQLite
35. `web_fetch` does not support uncapped full return directly.
36. Full uncapped retrieval is only through `get_web_content({ full: true })`.
37. Every capped response must clearly disclose:
    - full character count
    - returned character count
    - offset/range shown
    - exact follow-up call to retrieve more/full content
38. `get_web_content` caps by default but supports paging and `full: true`.
39. Include `/web-access` diagnostic command with no API calls and no secret values.
40. Include tests for pure/mocked logic. No live Exa/Firecrawl tests by default.
41. Implementation should be phased and reviewable.

## Repository/package layout

Adopt an agent-level pnpm package layout:

```text
agent/
  package.json
  pnpm-lock.yaml
  .env                 # ignored, local secrets
  .env.example         # committed
  extensions/
    web-access/
      index.ts
      src/
        config.ts
        types.ts
        cache.ts
        router.ts
        tools/
          web-search.ts
          code-search.ts
          web-fetch.ts
          get-web-content.ts
        providers/
          exa.ts
          firecrawl.ts
          direct-http.ts
          github.ts
        utils/
          caps.ts
          hash.ts
          urls.ts
          errors.ts
```

Notes:

- Pi auto-discovers `agent/extensions/web-access/index.ts` because it is under `~/.pi/agent/extensions/*/index.ts`.
- `pnpm install` should be run from `agent/`.
- `node_modules/` stays ignored.
- Keep the root `.pi` repo free from unrelated package/dependency files.
- Do not commit generated package installs or caches.

Suggested package metadata:

```json
{
  "name": "pi-agent-config",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "dependencies": {
    "@mendable/firecrawl-js": "^4.25.0",
    "dotenv": "^16.4.7",
    "exa-js": "^2.13.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "test": "node --test --import tsx ./extensions/web-access/test/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

The exact versions can be updated during implementation, but keep the dependency set intentional.

Pi imports should use current package names, not older examples:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
```

Use `StringEnum` for tool enum params for provider compatibility.

## Secrets and `.env`

Use:

```text
agent/.env
```

Commit:

```text
agent/.env.example
```

Initial `.env.example`:

```env
EXA_API_KEY=
FIRECRAWL_API_KEY=
GITHUB_TOKEN=
```

Rules:

- `EXA_API_KEY` required only when calling Exa-backed tools.
- `FIRECRAWL_API_KEY` required only when Firecrawl is needed.
- `GITHUB_TOKEN` optional; use for direct GitHub REST fallback when `gh` is not available/authenticated.
- Real environment variables take precedence over `.env` values.
- Startup validation must not make provider API calls.
- Never print or store secret values.

Update `.gitignore` so `agent/.env` remains ignored but `agent/.env.example` is committed. Current ignore patterns include `.env.*`, so implementation likely needs an unignore rule:

```gitignore
!agent/.env.example
```

## Config loading and diagnostics

At extension startup:

1. Load `.env` using `dotenv`:

   ```ts
   dotenv.config({
     path: join(homedir(), ".pi", "agent", ".env"),
     override: false,
   });
   ```

2. Validate local presence/non-empty with Zod.
3. Do not call Exa, Firecrawl, GitHub, or any network endpoint.
4. Register all tools regardless of missing keys.
5. Warn via UI if available, or console if not, when keys are missing.

Add command:

```text
/web-access
```

It should report non-secret diagnostics only:

```text
Web access:
  Exa key: present|missing
  Firecrawl key: present|missing
  GitHub token: present|missing
  gh CLI: available|unavailable|not checked?   # no network/auth call required
  Cache DB: /Users/curtis/.pi/agent/cache/web-access/cache.sqlite
  Search TTL: 24h
  Page TTL: 7d
  GitHub branch clone TTL: 24h
  Response TTL: 30d
```

The command must not call paid APIs. It may optionally check local executable availability for `gh`/`git` without network requests.

## Architecture

Use this boundary:

```text
Pi tools
→ our tool handlers
→ WebRouter / cache layer
→ our provider interfaces
→ Exa SDK / Firecrawl SDK / Direct HTTP / GitHub CLI/API
```

Never scatter SDK calls such as `exa.search(...)` or `firecrawl.scrape(...)` throughout tools. They belong only in provider adapters.

Never expose raw Exa/Firecrawl SDK response objects in tool output or cross-provider interfaces.

### Core interfaces

Keep provider interfaces small and normalized:

```ts
export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}

export interface PageFetcher {
  fetchPage(url: string, options?: FetchOptions): Promise<PageContent>;
}

export interface GitHubProvider {
  canHandle(url: string): GitHubRoute | null;
  fetchGitHub(url: string, options?: FetchOptions): Promise<PageContent>;
}
```

Suggested normalized types:

```ts
export interface SearchOptions {
  provider?: "exa";
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  recency?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
  kind?: "web" | "code";
  maxCharacters?: number;
}

export interface SearchResponse {
  query: string;
  provider: "exa";
  searchedAt: string;
  cacheHit: boolean;
  results: SearchResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
}

export interface FetchOptions {
  fetchMode?: "auto" | "direct" | "firecrawl" | "github";
  forceRefresh?: boolean;
  onlyMainContent?: boolean;
  waitForMs?: number;
  timeoutMs?: number;
}

export interface PageContent {
  url: string;
  title: string | null;
  markdown: string;
  source:
    | "cache"
    | "direct-http"
    | "firecrawl"
    | "github-clone"
    | "github-api"
    | "github-gh";
  fetchedAt: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
}
```

Provider-specific types must remain inside provider modules.

## Tool specifications

### `web_search`

Purpose: compact web discovery via Exa.

Use when:

- current/current-ish information is needed
- discovering sources, docs, changelogs, issues, comparisons
- finding pages to later fetch with `web_fetch`

Do not use as a full page reader by default.

Parameters:

```ts
{
  query?: string;
  queries?: string[];          // max 4
  maxResults?: number;         // default 5, max 10 per query
  includeDomains?: string[];
  excludeDomains?: string[];
  recency?: "day" | "week" | "month" | "year";
  forceRefresh?: boolean;
}
```

Behavior:

1. Normalize `query`/`queries` into a non-empty list.
2. Reject more than 4 queries.
3. Cap `maxResults` at 10.
4. For each query:
   - check SQLite search cache unless `forceRefresh`
   - call Exa via `ExaSearchProvider` if cache miss
   - store normalized results in cache
5. Store the grouped search response behind a `responseId`.
6. Return compact grouped results only.

Exa SDK behavior:

- Use `exa-js` internally.
- Prefer compact highlights/snippets. Do not request full page text by default.
- Suggested shape:

  ```ts
  exa.search(query, {
    type: "auto",
    numResults,
    includeDomains,
    excludeDomains,
    startPublishedDate, // for recency, if used
    contents: {
      highlights: { query, maxCharacters: 500 },
    },
  });
  ```

Output should include:

- query
- title
- URL
- domain
- short snippet/highlights
- published date when available
- `responseId` / `searchId`
- cache hit/miss metadata in compact form
- instructions to call `web_fetch` for full page content

Output should not include:

- full raw Exa response
- full page text
- provider cost/usage unless later intentionally added

### `code_search`

Purpose: code/docs/API/examples search via Exa.

Use when:

- programming question
- library/API docs
- implementation examples
- error/debugging search
- GitHub/source examples

Parameters:

```ts
{
  query: string;
  maxResults?: number;       // default 8, max 10
  maxCharacters?: number;    // default 12000, max 30000
  forceRefresh?: boolean;
}
```

Behavior:

- Single query only in V1.
- Uses Exa through a provider adapter.
- Query shaping should prefer official docs, GitHub, StackOverflow, changelogs, API references, and concrete examples.
- It may return more detail than `web_search`, but still capped.
- Store the full normalized code-search result behind a `responseId`.
- If a source needs full context, tell the model to call `web_fetch` for the specific URL.

Suggested Exa SDK approach:

```ts
exa.search(query, {
  type: "auto",
  numResults,
  systemPrompt: "Prefer official documentation, source code, GitHub issues, changelogs, and concrete code examples. Avoid duplicate sources.",
  contents: {
    highlights: { query, maxCharacters: 1000 },
    text: { maxCharacters: 2000 },
  },
});
```

The provider adapter must normalize and cap output before returning to tools.

### `web_fetch`

Purpose: fetch/read one or more URLs while preserving context cleanliness.

Parameters:

```ts
{
  url?: string;
  urls?: string[];             // max 5 total URLs
  fetchMode?: "auto" | "direct" | "firecrawl" | "github";
  forceRefresh?: boolean;
  onlyMainContent?: boolean;   // Firecrawl, default true
  waitForMs?: number;          // Firecrawl
  timeoutMs?: number;          // default 30000
}
```

Behavior:

1. Normalize `url`/`urls` into a non-empty URL list.
2. Reject more than 5 URLs.
3. For each URL route via `WebRouter`:
   - check page cache unless `forceRefresh`
   - GitHub code URL → clone/fetch via GitHub provider
   - GitHub issue/PR URL → GitHub metadata provider
   - conservative direct fetch for cheap/static sources
   - Firecrawl scrape for normal webpages or direct failures
4. Store all full clean content in SQLite.
5. Create a `responseId` for this fetch call.
6. Single URL: return clean markdown up to ~20k chars.
7. Multi URL: return compact per-URL summaries and `responseId`.
8. If content is capped, clearly disclose how to retrieve the rest.

`web_fetch` must never allow uncapped full content return directly. Full content retrieval goes through `get_web_content`.

#### Fetch routing policy

Default `fetchMode: "auto"`:

```text
1. Page cache
2. GitHub structured handling if GitHub URL
3. DirectHttpFetcher for cheap/static/agent-friendly content only
4. Firecrawl scrape for normal HTML/web pages
```

`fetchMode` overrides:

- `github`: only GitHub provider; fail clearly if URL is not supported GitHub URL.
- `direct`: use direct fetch intentionally. May return raw/static text, but still cap and label. Avoid by default for HTML.
- `firecrawl`: use Firecrawl scrape directly, after cache unless `forceRefresh`.
- `auto`: default routing.

#### Context cleanliness rule

If direct fetch retrieves messy HTML in `auto` mode:

- do not return it
- do not put it in `details`
- do not cache it
- do not include it in progress updates
- discard internally and use Firecrawl

Progress updates can say only:

```text
Trying direct fetch...
Falling back to Firecrawl for clean markdown...
```

#### DirectHttpFetcher allowed sources

Direct fetch may return content in `auto` mode for sources that are already agent-friendly:

- `raw.githubusercontent.com`
- GitHub raw file URLs
- `llms.txt`
- `text/plain`, `text/markdown`, `application/json`, `application/xml`, NDJSON
- package registry APIs
- small static text/code assets when content type is non-HTML

Normal `text/html` pages should route to Firecrawl in `auto` mode.

#### FirecrawlFetcher

Use `@mendable/firecrawl-js` internally.

V1 should use scrape only:

```ts
firecrawl.scrape(url, {
  formats: ["markdown"],
  onlyMainContent: options.onlyMainContent ?? true,
  waitFor: options.waitForMs,
  timeout: options.timeoutMs ?? 30000,
});
```

Defer Firecrawl crawl/map/extract/batch to later.

### `get_web_content`

Purpose: retrieve stored full search/fetch content by response ID.

Parameters:

```ts
{
  responseId: string;
  url?: string;
  urlIndex?: number;
  query?: string;
  queryIndex?: number;
  offset?: number;       // default 0
  maxChars?: number;     // default 30000
  full?: boolean;        // explicit opt-in to return entire stored content
}
```

Behavior:

- Look up `responseId` from SQLite `web_responses`.
- Select requested URL/query when response contains multiple items.
- Default capped return: `offset` + `maxChars`.
- If `full: true`, return the full stored content with no hard cap.
- Always disclose counts/ranges:
  - full character count
  - returned character count
  - offset/range returned
  - whether more content exists
  - exact follow-up call for next chunk or full content

If `full: true` returns huge content, that is intentional. The tool description should warn the model to use it only when necessary.

## GitHub handling

### Code URLs: clone locally

Supported clone routes:

- `https://github.com/:owner/:repo`
- `https://github.com/:owner/:repo/tree/:ref/...`
- `https://github.com/:owner/:repo/blob/:ref/...`

Do not clone:

- issues
- pulls
- discussions
- wiki
- releases
- actions
- commits pages
- compare pages
- other non-code GitHub pages

Clone path:

```text
agent/cache/web-access/github/<owner>/<repo>[@ref]
```

Use safe path construction. Validate owner/repo/ref/path. Prevent path traversal when reading files from clone.

Clone process:

1. Check GitHub clone cache/TTL unless `forceRefresh`.
2. If `gh` CLI is available, try:

   ```text
   gh repo clone owner/repo <target> -- --depth 1 --single-branch [--branch ref]
   ```

3. If `gh` is unavailable or clone fails, fallback to:

   ```text
   git clone --depth 1 --single-branch [--branch ref] https://github.com/owner/repo.git <target>
   ```

4. For commit SHA refs, avoid shallow branch assumptions if needed; use GitHub API or explicit checkout strategy.
5. Cache branch refs for 24h.
6. Cache commit SHA refs for a very long TTL or no expiry.

Clone output:

- repo root: local path, capped tree, README preview
- `/tree/`: local path and directory listing
- `/blob/`: local path and capped file content if text; binary files labeled as binary
- always tell model it can use built-in `read`/`bash` on the local path

Safety:

- skip `.git` internals in listings
- skip common noisy dirs such as `node_modules`, `dist`, `build`, `.next`, `.venv`, `target`
- cap tree/listing entries
- cap inline file preview
- detect binary files by extension and NUL bytes

### Issue/PR URLs: structured GitHub metadata

Supported V1 routes:

- `https://github.com/:owner/:repo/issues/:number`
- `https://github.com/:owner/:repo/pull/:number`

Access order:

1. `gh` CLI when available/authenticated.
2. Direct GitHub REST using `GITHUB_TOKEN` if set.
3. Direct unauthenticated GitHub REST for public repos.
4. Firecrawl fallback only if structured access fails.

Issue output:

- title
- state
- author
- labels
- created/updated timestamps
- body, capped
- comments, capped by count and total characters
- full normalized payload stored in cache/response where feasible

PR output:

- title
- state
- author
- labels
- created/updated timestamps
- body, capped
- comments/reviews, capped
- changed files summary: filename, status, additions/deletions/changes
- no full diffs by default
- full normalized payload stored in cache/response where feasible

Do not spend Firecrawl credits on GitHub issue/PR pages unless structured access fails.

## Caching design

Use SQLite via built-in `node:sqlite`.

Cache path:

```text
agent/cache/web-access/cache.sqlite
```

Ensure parent directories are created. This path is already ignored by existing cache ignore patterns.

If `node:sqlite` is unavailable, fail gracefully with a clear local error. Do not silently disable caching.

### Schema

Minimum schema:

```sql
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS web_pages (
  cache_key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title TEXT,
  markdown TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_pages_url ON web_pages(normalized_url);

CREATE TABLE IF NOT EXISTS web_searches (
  cache_key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  provider TEXT NOT NULL,
  options_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  searched_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS web_responses (
  response_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS github_clones (
  cache_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  ref TEXT,
  local_path TEXT NOT NULL,
  cloned_at TEXT NOT NULL,
  expires_at TEXT,
  metadata_json TEXT
);
```

Exact schema can evolve during implementation, but preserve these concepts.

### Cache keys

Use stable SHA-256 keys from canonical JSON.

Search key includes:

- provider
- query
- kind (`web` or `code`)
- normalized options affecting result shape
- cache schema/version marker

Page key includes:

- normalized URL
- fetch mode/provider source when relevant
- options affecting output (`onlyMainContent`, etc.)
- cache schema/version marker

GitHub clone key includes:

- owner
- repo
- ref if present

### TTL defaults

```ts
searchTtlHours = 24;
pageTtlHours = 24 * 7;
githubBranchCloneTtlHours = 24;
githubCommitCloneTtlHours = 24 * 365 * 10; // or null expiry
responseTtlHours = 24 * 30;
```

`forceRefresh: true` bypasses cache and replaces the entry.

### Response IDs

Every successful `web_search`, `code_search`, and `web_fetch` should create a `responseId` entry. This is separate from provider cache entries.

`responseId` is for context management and later retrieval. Provider cache entries are for avoiding repeated network/paid calls.

## Output and cap disclosure

All tools must avoid accidental context floods.

Default caps:

- `web_search`: compact snippets only
- `code_search`: default total direct output ~12k chars, max 30k
- `web_fetch` single URL: inline ~20k chars
- `web_fetch` multi URL: compact summary only
- `get_web_content`: default 30k chars
- `get_web_content({ full: true })`: no hard cap

Every capped output must include a clear note like:

```text
[Content capped: showing chars 0-20000 of 84531.]
Full content is stored as responseId "abc123".
To retrieve the next chunk: get_web_content({ responseId: "abc123", urlIndex: 0, offset: 20000, maxChars: 30000 })
To retrieve all content intentionally: get_web_content({ responseId: "abc123", urlIndex: 0, full: true })
```

Do not hide capped/full retrieval instructions only in `details`; include them in visible tool content so the model sees them.

Tool `details` should contain metadata only, not huge content bodies.

## Error behavior

- Missing `EXA_API_KEY`: `web_search`/`code_search` return clear tool error content.
- Missing `FIRECRAWL_API_KEY`: `web_fetch` only fails when routing requires Firecrawl and no direct/GitHub path works.
- Missing `GITHUB_TOKEN`: never fatal; use `gh` or unauthenticated public REST when possible.
- Provider errors should be normalized into concise messages.
- Do not leak headers, tokens, raw request bodies, or full SDK error objects.
- Throw from tool `execute` only when Pi should mark the tool call as error; otherwise return concise error content with metadata. Prefer throwing for invalid provider execution after local validation if the model should retry differently.

## UI/rendering

V1 does not need custom UI beyond compact tool rendering and `/web-access` diagnostics.

Recommended render behavior:

- `web_search`: show query count, result count, cache hit/miss summary.
- `code_search`: show query and returned source count.
- `web_fetch`: show URL count, source (`github-clone`, `firecrawl`, `direct-http`, cache), content length, capped/full indicator.
- `get_web_content`: show selected target and returned character range.

No browser curator, no activity widget in V1.

## Security and safety notes

- Do not commit secrets, `.env`, cache DB, clones, sessions, logs, or package installs.
- Do commit `.env.example`.
- Use `execFile`/argument arrays for `git`/`gh`, not shell string concatenation.
- Sanitize owner/repo/ref/path for GitHub URLs.
- Prevent path traversal when reading cloned repo paths.
- Do not execute code from cloned/fetched repos.
- Do not expose API keys in logs, tool output, details, or cache metadata.
- Treat fetched web content as untrusted text.

## Tests

Include tests for pure/mocked logic. Do not run live Exa or Firecrawl tests by default.

Suggested tests:

- env/config parsing:
  - env vars win over `.env`
  - missing keys produce non-fatal status
  - no network calls happen during config validation
- URL classification/routing:
  - GitHub root/blob/tree code URLs
  - GitHub issue/PR URLs
  - GitHub non-code URLs fall through
  - raw/static URLs direct-fetch eligible
  - normal HTML URLs Firecrawl eligible
- GitHub URL parsing:
  - branch refs
  - paths under `/blob` and `/tree`
  - reject path traversal attempts
- cache:
  - stable key generation
  - TTL hit/miss
  - `forceRefresh` bypass
  - response ID retrieval
- cap disclosure:
  - capped outputs include counts and exact follow-up calls
  - `full: true` returns all stored content
- provider normalization:
  - mocked Exa SDK response → normalized `SearchResult[]`
  - mocked Firecrawl response → normalized `PageContent`
- direct fetch cleanliness:
  - HTML in auto mode is rejected for Firecrawl fallback without exposing raw HTML

## Implementation phases

Stop for review after each phase unless the user explicitly asks to continue without review.

### Phase 0 — Spec approval and ADR

- Review this spec with user.
- After approval, create `docs/decisions/0003-add-focused-web-access-extension.md` summarizing durable decisions.
- No extension code before spec approval.

### Phase 1 — Agent package and env scaffolding

Files:

- `agent/package.json`
- `agent/pnpm-lock.yaml`
- `agent/.env.example`
- `.gitignore` update for `!agent/.env.example`

Actions:

- Add pnpm package at `agent/`.
- Add dependencies and devDependencies.
- Run `cd agent && pnpm install`.
- Do not commit `node_modules`.
- Add `.env.example` with Exa/Firecrawl/GitHub variables.

Review checkpoint:

- Verify lockfile and ignore rules.

### Phase 2 — Extension skeleton and config validation

Files:

- `agent/extensions/web-access/index.ts`
- `agent/extensions/web-access/src/config.ts`
- `agent/extensions/web-access/src/types.ts`
- initial test files if helpful

Actions:

- Register `/web-access` diagnostic command.
- Load `.env` via dotenv.
- Validate env presence/non-empty via Zod without API calls.
- Register placeholder tools or no-op tool shells with clear “not implemented yet” messages.

Review checkpoint:

- Start Pi or run a minimal Pi command to ensure extension loads.
- `/web-access` shows non-secret diagnostics.

### Phase 3 — SQLite cache layer

Files:

- `src/cache.ts`
- `src/utils/hash.ts`
- cache tests

Actions:

- Implement schema initialization.
- Implement search/page/response/clone cache helpers.
- Implement TTL checks and `forceRefresh` bypass support.
- Implement response ID creation and retrieval.

Review checkpoint:

- Run tests for cache and hashing.

### Phase 4 — URL routing, direct fetch, and GitHub parsing

Files:

- `src/router.ts`
- `src/providers/direct-http.ts`
- `src/providers/github.ts` parsing helpers only at first
- `src/utils/urls.ts`

Actions:

- Implement URL classifier.
- Implement conservative direct-fetch eligibility.
- Implement direct fetch for static/agent-friendly content.
- Ensure HTML in auto mode is rejected internally.
- Implement GitHub URL parsing tests.

Review checkpoint:

- Run routing/parser/direct-fetch tests with mocked fetch where possible.

### Phase 5 — Exa provider and search tools

Files:

- `src/providers/exa.ts`
- `src/tools/web-search.ts`
- `src/tools/code-search.ts`

Actions:

- Implement Exa provider adapter using `exa-js`.
- Normalize SDK responses into internal types.
- Implement compact `web_search`.
- Implement capped `code_search`.
- Store search responses and provider cache entries.
- Ensure missing `EXA_API_KEY` errors are clear.

Review checkpoint:

- Run mocked provider normalization tests.
- Optional manual live call only if user explicitly approves using Exa credits.

### Phase 6 — GitHub provider

Files:

- `src/providers/github.ts`

Actions:

- Implement code URL cloning with `gh` then `git` fallback.
- Implement clone cache metadata/TTL.
- Implement root/tree/blob previews.
- Implement issue/PR metadata fetching via `gh`, REST token, unauth REST, then Firecrawl fallback hook.
- Cap discussions/reviews/file summaries.

Review checkpoint:

- Test parsing and formatting without network.
- Optional manual public GitHub fetch/clone if user approves.

### Phase 7 — Firecrawl provider and `web_fetch`

Files:

- `src/providers/firecrawl.ts`
- `src/tools/web-fetch.ts`

Actions:

- Implement Firecrawl scrape adapter using `@mendable/firecrawl-js`.
- Implement `web_fetch` routing across cache/GitHub/direct/Firecrawl.
- Store full content in SQLite.
- Return hybrid inline/summary output with response IDs and cap disclosure.
- Ensure missing `FIRECRAWL_API_KEY` errors only occur when Firecrawl is needed.

Review checkpoint:

- Run mocked Firecrawl tests.
- Optional manual live scrape only if user explicitly approves using Firecrawl credits.

### Phase 8 — `get_web_content`

Files:

- `src/tools/get-web-content.ts`
- `src/utils/caps.ts`

Actions:

- Implement selector logic by `responseId`, URL/index, query/index.
- Implement offset/maxChars paging.
- Implement `full: true` full retrieval.
- Ensure all capped outputs disclose counts/ranges and exact next/full calls.

Review checkpoint:

- Run cap disclosure and response retrieval tests.

### Phase 9 — Rendering, docs, and final checks

Actions:

- Add compact renderers for all tools if useful.
- Ensure prompt snippets/guidelines are precise and name the tools explicitly.
- Run tests and typecheck.
- Update README or docs if needed.
- Verify no secrets/caches/node_modules are staged.

Review checkpoint:

- Final review of changed files.

## Prompt snippets/guidelines draft

Use prompt snippets/guidelines carefully because Pi appends guidelines flat without tool grouping.

Draft snippets:

- `web_search`: `Search the web with Exa for compact source discovery; use web_fetch to read selected sources fully.`
- `code_search`: `Search for programming docs, APIs, examples, GitHub issues, and source references with compact capped output.`
- `web_fetch`: `Fetch URL content cleanly; clones GitHub code URLs locally and uses Firecrawl for normal webpages.`
- `get_web_content`: `Retrieve stored full/capped content from prior web_search/code_search/web_fetch results by responseId.`

Draft guidelines:

- `Use web_search for discovering relevant web sources; do not use it when you already have a URL to read.`
- `Use code_search for programming/library/API questions before implementing against unfamiliar APIs.`
- `Use web_fetch to read selected URLs; for GitHub repository/blob/tree URLs, web_fetch provides a local clone/path when possible.`
- `Use get_web_content when a previous web tool result says content was capped or stored under a responseId.`
- `Do not request get_web_content with full: true unless the full stored content is necessary; prefer offsets/chunks for very large pages.`

## Open/deferred items

Deferred beyond V1:

- Firecrawl crawl/map/extract/batch tools.
- Firecrawl search fallback for `web_search`.
- Exa answer/deep search/research/agent APIs.
- Exa similar-page search.
- Browser curator UI.
- Activity monitor widget.
- PDF-specific extraction pipeline.
- YouTube/video support.
- Cross-repo/package distribution.
- Cache clear/admin commands beyond `/web-access` diagnostics.
- Usage/cost accounting beyond cache hit/miss metadata.

