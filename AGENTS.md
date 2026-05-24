# Pi Config Repo Instructions

This repository contains my personal Pi coding-agent configuration.

## Rules

- Do not commit secrets, auth tokens, session logs, caches, or generated package installs.
- Before adding a skill or extension, record why it is useful and whether it should be global or project-local.
- Prefer small, inspectable files over opaque memory systems.
- Prefer adapting selected skills over importing large methodology packs wholesale.
- Use GitHub Issues for candidates/backlog and `docs/decisions/` for final decisions.
- Keep changes easy to revert and review.

## Current direction

- Coordinator Pi session delegates work to worker Pi sessions through tmux.
- Worker coordination should use durable files or GitHub Issues, not hidden chat memory.
- Project memory should be explicit markdown: AGENTS.md, CONTEXT.md, ADRs, wiki/log/index files.
