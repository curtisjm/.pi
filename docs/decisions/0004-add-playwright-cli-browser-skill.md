# 0004 Add Playwright CLI browser skill

Date: 2026-05-27

## Status

Accepted

## Context

Pi needs browser-control capability for cross-project tasks such as checking local web apps, reproducing UI bugs, inspecting console and network activity, and capturing screenshots/traces. The candidate options were a direct CLI skill, a Pi extension that registers browser tools, and higher-level browser-agent frameworks.

## Decision

Add a global `playwright-cli` skill under `agent/skills/playwright-cli` and use the external `playwright-cli` command through Pi's existing `bash` tool.

Do not build a Pi extension yet. The CLI already provides a compact, agent-oriented command surface, persistent sessions, snapshots with element refs, screenshots, console/network inspection, tracing, and test helpers.

## Scope

Global skill. Browser control is useful across projects, while the skill remains small and inspectable. Project-specific browser policies can still be added later in project `AGENTS.md` files.

## Consequences

- Pi can use browser automation without loading a large custom tool schema.
- The setup stays easy to review and revert.
- Authentication state and persistent browser profiles must be treated as sensitive.
- If CLI-only usage proves awkward, a future extension can wrap the most common commands with typed tools, default session names, artifact routing, or safety gates.

## Local setup note

`playwright-cli` was already on PATH. Chrome initially failed because Playwright looked for `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, while Nix exposed Chrome through `/run/current-system/Applications/Google Chrome.app` and `/Applications/Nix Apps/Google Chrome.app`. A local `/Applications/Google Chrome.app -> /run/current-system/Applications/Google Chrome.app` symlink makes Playwright's default Chrome channel use the Nix-managed Chrome. Smoke test passed with `playwright-cli -s=chrome-smoke open https://example.com`.
