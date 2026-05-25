# 0002 Initial Pi configuration scope

## Status

Accepted

## Decision

The initial Pi configuration includes:

- a lightweight `~/.pi` repo structure without `package.json` or `tsconfig.json` until TypeScript extension complexity requires them
- a git safety extension that prevents git editor hangs and blocks `--no-verify`
- a tmux skill adapted for both Pi worker agents and generic interactive processes
- a curated vendored set of Matt Pocock skills
- a local `handoff-tmux` skill for continuing context in a fresh Pi agent in the same tmux session and same working directory

The initial configuration excludes/defer these items:

- file-backed todos extension
- pi-cloak/secret masking
- web search/fetch tooling
- pi-skill-toggle
- OpenCode Cloudflare provider extension
- custom Tokyo Night theme
- `package.json`/`tsconfig.json` workspace setup

## Rationale

The setup should become useful quickly without recreating a heavy orchestration framework. The first layer focuses on safe git behavior, explicit skills, and tmux-based workflows. More complex extensions can be added later after the core workflow is proven.

## Notes

For worker-style delegation, tmux workflows should default to isolated git worktrees. For handoff/continuation workflows, `handoff-tmux` should default to the same working directory.
