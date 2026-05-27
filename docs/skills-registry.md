# Skills Registry

This file tracks vendored skills, their upstream source, local ownership status, and update policy.

## Policy

Vendored skills are local source of truth. Upstream is advisory.

For each vendored skill, record:

- local path
- upstream repository and path
- upstream commit/ref when first copied or last reviewed
- local status: candidate, adopted, modified, rejected, retired
- update policy: manual drift review unless otherwise noted
- notes about local Pi-specific changes

When reviewing drift, compare the local skill against upstream and decide whether to ignore, port, or replace changes. Record meaningful ports in commits and/or the related GitHub issue.

## Skills

| Skill | Local path | Upstream | Upstream ref | Status | Update policy | Notes |
|---|---|---|---|---|---|---|
| grill-me | `agent/skills/grill-me` | `mattpocock/skills:skills/productivity/grill-me` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| grill-with-docs | `agent/skills/grill-with-docs` | `mattpocock/skills:skills/engineering/grill-with-docs` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| tdd | `agent/skills/tdd` | `mattpocock/skills:skills/engineering/tdd` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| diagnose | `agent/skills/diagnose` | `mattpocock/skills:skills/engineering/diagnose` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| to-prd | `agent/skills/to-prd` | `mattpocock/skills:skills/engineering/to-prd` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| zoom-out | `agent/skills/zoom-out` | `mattpocock/skills:skills/engineering/zoom-out` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| improve-codebase-architecture | `agent/skills/improve-codebase-architecture` | `mattpocock/skills:skills/engineering/improve-codebase-architecture` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | modified | manual drift review | replaced Claude-style sub-agent/Agent-tool instructions with direct Pi tool use and sequential alternatives |
| setup-matt-pocock-skills | `agent/skills/setup-matt-pocock-skills` | `mattpocock/skills:skills/engineering/setup-matt-pocock-skills` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | modified | manual drift review | prefers AGENTS.md over CLAUDE.md for Pi |
| prototype | `agent/skills/prototype` | `mattpocock/skills:skills/engineering/prototype` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| handoff | `agent/skills/handoff` | `mattpocock/skills:skills/productivity/handoff` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | adopted | manual drift review | copied from upstream |
| tmux | `agent/skills/tmux` | `dmmulroy/.dotfiles:home/.pi/agent/skills/tmux`, informed by `obra/superpowers:skills/using-git-worktrees` | `dmmulroy 55dbc9172e47f0c30d3c2cc1dd31dbf25bdac4c5`; `superpowers f2cbfbefebbfef77321e4c9abc9e949826bea9d7` | modified | manual drift review | adapted for Pi names, dual worker/process use, and repo-near worktree convention |
| handoff-tmux | `agent/skills/handoff-tmux` | local derivative of `mattpocock/skills:skills/productivity/handoff` plus local tmux conventions | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | modified | manual drift review | local continuation workflow; same cwd by default, not task delegation |
| playwright-cli | `agent/skills/playwright-cli` | `microsoft/playwright-cli:skills/playwright-cli` | `3a1bafc8b4e973c72d0364eb5b427d1ce0aa8317` | modified | manual drift review | global skill for cross-project browser control in Pi; adapted frontmatter and added Pi usage/security notes; extension deferred until typed wrappers or safety gates are needed |
