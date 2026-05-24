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
- Web fetch/search provider
