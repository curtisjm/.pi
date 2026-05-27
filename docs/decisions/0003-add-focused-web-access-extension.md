# 0003 Add focused web access extension

## Status

Accepted

## Decision

Add a focused web access extension as a global personal Pi extension tracked in this repository at:

```text
agent/extensions/web-access/
```

The extension will provide a small, generic tool surface:

- `web_search`
- `code_search`
- `web_fetch`
- `get_web_content`

The implementation will use provider adapters behind local interfaces instead of exposing provider-specific SDKs or response shapes. V1 providers are:

- Exa, via `exa-js`, for web discovery and code/docs/example search.
- Firecrawl, via `@mendable/firecrawl-js`, for clean page scraping when normal webpages need markdown extraction.
- Direct HTTP, via native `fetch`, only for cheap/static/agent-friendly sources.
- GitHub handling for code URLs and issue/PR metadata, preferring local clones or structured metadata over scraping GitHub HTML.

The extension will be installed using an agent-level pnpm package layout under `agent/`, not a package per extension. Secrets will live only in `agent/.env`; `agent/.env.example` will be committed.

Startup validation must be local-only: load `.env`, validate key presence/non-empty state, register tools, and report missing provider keys without making Exa, Firecrawl, or GitHub network calls. Missing provider keys are non-fatal at Pi startup; tools fail clearly only when the missing provider is required.

The extension will cache search results, fetched pages, response records, and GitHub clone metadata in SQLite at:

```text
agent/cache/web-access/cache.sqlite
```

Default cache lifetimes are:

- Exa search results: 24 hours
- fetched pages: 7 days
- GitHub branch clones: 24 hours
- GitHub commit-SHA clones: very long-lived
- response records: 30 days

Tool outputs must stay context-clean. Search tools return compact capped results. `web_fetch` stores full content but returns capped inline content or summaries. Full content retrieval is explicit through `get_web_content`, and every capped response must disclose full/returned character counts plus exact follow-up calls for more or full content.

## Rationale

Web search and fetch are useful across projects, so this belongs in the global personal Pi configuration rather than a project-local extension. Keeping the source in this repo makes it auditable, reviewable, and easy to trim.

The existing `pi-web-access` package is broader than needed. This configuration should borrow selected ideas—generic tool names, response IDs, explicit full-content retrieval, GitHub code cloning, and separate code-search intent—without importing unrelated providers, browser UI, activity widgets, bundled skills, or video/PDF-specific pipelines.

A cache-first and provider-adapter architecture reduces repeated paid calls, avoids leaking SDK details into tools, and keeps model context small by default.

## Consequences

- Add `agent/package.json`, `agent/pnpm-lock.yaml`, and TypeScript extension source under `agent/extensions/web-access/`.
- Commit `agent/.env.example`, but never commit `agent/.env`, cache DBs, clones, package installs, sessions, logs, or secrets.
- Update `.gitignore` so `agent/.env.example` remains trackable despite broad `.env.*` ignore rules.
- Use local tests and mocked provider tests by default. Do not make live Exa, Firecrawl, or GitHub provider calls during startup validation or tests.
- Implement in reviewable phases, stopping after each phase before editing the next phase's files.

## Explicit V1 exclusions

V1 will not include:

- Perplexity
- Gemini API or Gemini Web cookie access
- browser curator UI
- activity widget
- YouTube/video support
- PDF-specific extraction beyond what Firecrawl/direct fetch naturally returns
- Jina fallback
- bundled skills
- GitHub cloning for non-code pages
- Firecrawl crawl/map/extract/batch tools
- Exa answer/deep research/agent APIs
