# .pi

Personal Pi coding-agent configuration.

This repo tracks the durable parts of my Pi setup: settings, skills, extensions, prompts, themes, and decisions about how the setup should evolve.

## Policy

- GitHub Issues track candidate config changes and setup backlog.
- `docs/decisions/` tracks settled decisions and rationale.
- Config files are the executable result.
- Do not commit auth files, sessions, local caches, package installs, or secrets.

## Current goals

- Replace heavier agent orchestration with lightweight Pi + tmux worker sessions.
- Use transparent file-backed memory and task tracking where possible.
- Curate a small set of high-value skills instead of importing large packs wholesale.
- Keep the setup understandable, portable, and easy to audit.

## Areas under evaluation

- dmmulroy Pi config structure and extensions
- Matt Pocock engineering skills
- Superpowers skills worth adapting
- Karpathy-style LLM wiki memory
- Local todos vs GitHub Issues vs Linear for task tracking
- Tmux-based Pi worker delegation

## Implemented extensions

- `agent/extensions/git-interceptor.ts`: protects agent-driven git commands from editor hangs and blocks `--no-verify`.
- `agent/extensions/web-access/`: focused web search/fetch extension with Exa search, Firecrawl clean scraping, direct static fetches, GitHub clone/API handling, and SQLite response/cache storage.

## Web access extension

The web access extension is a global personal Pi extension at `agent/extensions/web-access/`. It intentionally implements only the web capabilities expected to be useful across projects, rather than installing a broad third-party web-access package wholesale.

Available tools:

- `web_search`: compact Exa-backed web discovery for finding sources.
- `code_search`: Exa-backed programming/docs/API/example search.
- `web_fetch`: cleanly reads URLs, with GitHub-aware routing and capped output.
- `get_web_content`: retrieves stored full or paged content from previous web tool results by `responseId`.

Design decisions:

- Generic tool names are exposed to the model; provider-specific SDKs stay behind local adapters.
- Startup validation is local-only: it checks `.env` key presence but does not call Exa, Firecrawl, GitHub, or spend API credits.
- Missing provider keys are non-fatal at startup; tools fail clearly only when a required provider is used.
- Search/fetch results are cached in SQLite at `agent/cache/web-access/cache.sqlite` and full results are stored behind response IDs.
- Tool output is context-clean by default: search is compact, fetch output is capped/summarized, and uncapped full content requires an explicit `get_web_content({ full: true })` call.
- Normal webpages route to Firecrawl for clean markdown; cheap/static/agent-friendly sources can use direct HTTP.
- GitHub Gist pages route to raw gist content to avoid noisy scraped GitHub chrome.
- GitHub repo/tree/blob URLs clone locally; GitHub issue/PR URLs prefer structured `gh`/REST metadata before any scraping fallback.
- Secrets belong in `agent/.env`; only `agent/.env.example` is committed.

See `docs/decisions/0003-add-focused-web-access-extension.md` for the durable rationale and scope.
