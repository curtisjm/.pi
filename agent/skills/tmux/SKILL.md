---
name: tmux
description: Use tmux for Pi worker agents and interactive long-running processes. Supports isolated Pi worker sessions, dev servers, test watchers, REPLs, debuggers, pane output capture, and prompt synchronization.
---

# tmux

Use tmux as a programmable terminal multiplexer for two workflows:

1. **Pi worker agents** — fresh Pi instances that continue or perform work in another tmux window.
2. **Interactive processes** — dev servers, test watchers, REPLs, debuggers, database shells, and other long-running TTY commands.

## Core principles

- Use a private Pi tmux socket; do not interfere with the user's personal tmux server.
- Discover panes dynamically; never hardcode pane indices from examples.
- Print copy/paste monitor commands immediately after starting a session/window.
- For worker Pi agents, use isolated git worktrees by default unless the workflow is an explicit handoff/continuation or the user requests same-directory work.
- For generic interactive commands, use the current working directory by default.
- Capture output instead of guessing command state.

## Socket convention

Use this socket unless the user or project specifies another:

```bash
export PI_TMUX_SOCKET_DIR="${PI_TMUX_SOCKET_DIR:-${TMPDIR:-/tmp}/pi-tmux-sockets}"
mkdir -p "$PI_TMUX_SOCKET_DIR"
SOCKET="$PI_TMUX_SOCKET_DIR/pi.sock"
```

Always pass `-S "$SOCKET"` to tmux commands.

## Starting an interactive process

Interactive process sessions run in the current working directory by default.

```bash
export PI_TMUX_SOCKET_DIR="${PI_TMUX_SOCKET_DIR:-${TMPDIR:-/tmp}/pi-tmux-sockets}"
mkdir -p "$PI_TMUX_SOCKET_DIR"
SOCKET="$PI_TMUX_SOCKET_DIR/pi.sock"
SESSION="dev-server"

tmux -S "$SOCKET" new-session -d -s "$SESSION" -n shell -c "$PWD"
TARGET=$(tmux -S "$SOCKET" list-panes -t "$SESSION" -F '#S:#I.#P' | head -n1)
tmux -S "$SOCKET" send-keys -t "$TARGET" -l -- 'pnpm dev'
tmux -S "$SOCKET" send-keys -t "$TARGET" Enter
```

Immediately tell the user:

```text
To monitor this session:
  tmux -S "$SOCKET" attach -t "$SESSION"

To capture recent output:
  TARGET=$(tmux -S "$SOCKET" list-panes -t "$SESSION" -F '#S:#I.#P' | head -n1)
  tmux -S "$SOCKET" capture-pane -p -J -t "$TARGET" -S -200
```

## Worker Pi sessions

Worker Pi sessions are for independent delegated work. Default to a dedicated git worktree.

### Worktree convention

Before creating a worktree, detect whether you are already isolated:

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
SUPERPROJECT=$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)
```

If `GIT_DIR != GIT_COMMON` and `SUPERPROJECT` is empty, you are already in a linked worktree. Do not create another worktree.

If creating a worktree, use this priority order:

1. Explicit user/project instruction.
2. Existing `.worktrees/` or `worktrees/` at repo root, but only if ignored.
3. Existing `../.pi-worktrees/<repo-name>/`.
4. Default `../.pi-worktrees/<repo-name>/<task-slug>`.

Use branch names:

```text
pi/<task-slug>
```

Default creation pattern:

```bash
ROOT=$(git rev-parse --show-toplevel)
REPO=$(basename "$ROOT")
PARENT=$(dirname "$ROOT")
TASK_SLUG="issue-123-example"
WORKTREE_ROOT="$PARENT/.pi-worktrees/$REPO"
WORKTREE="$WORKTREE_ROOT/$TASK_SLUG"
BRANCH="pi/$TASK_SLUG"

mkdir -p "$WORKTREE_ROOT"
git worktree add -b "$BRANCH" "$WORKTREE"
```

If using project-local `.worktrees/` or `worktrees/`, verify it is ignored before creating worktrees there:

```bash
git check-ignore -q .worktrees || git check-ignore -q worktrees
```

If the chosen project-local directory is not ignored, ask before editing `.gitignore`.

### Starting a worker Pi agent

```bash
export PI_TMUX_SOCKET_DIR="${PI_TMUX_SOCKET_DIR:-${TMPDIR:-/tmp}/pi-tmux-sockets}"
mkdir -p "$PI_TMUX_SOCKET_DIR"
SOCKET="$PI_TMUX_SOCKET_DIR/pi.sock"
SESSION="pi-worker-$TASK_SLUG"

tmux -S "$SOCKET" new-session -d -s "$SESSION" -n worker -c "$WORKTREE"
TARGET=$(tmux -S "$SOCKET" list-panes -t "$SESSION" -F '#S:#I.#P' | head -n1)
tmux -S "$SOCKET" send-keys -t "$TARGET" -l -- 'pi "You are a worker Pi instance. Read AGENTS.md first. Work only on the assigned task. Record findings and handoff notes before stopping."'
tmux -S "$SOCKET" send-keys -t "$TARGET" Enter
```

## Handoff/continuation sessions

Handoff sessions are different from delegated worker tasks. If the goal is to continue the current session context in a fresh Pi instance, use the same working directory by default. Do not create a worktree unless explicitly requested.

## Capturing output

```bash
TARGET=$(tmux -S "$SOCKET" list-panes -t "$SESSION" -F '#S:#I.#P' | head -n1)
tmux -S "$SOCKET" capture-pane -p -J -t "$TARGET" -S -200
```

Use joined lines (`-J`) to avoid wrapping artifacts.

## Waiting for text

Use the bundled helper from this skill directory:

```bash
./scripts/wait-for-text.sh -S "$SOCKET" -t "$TARGET" -p 'Ready' -T 30 -l 2000
```

Use this for prompts, server-ready messages, debugger stops, and long-running command synchronization.

## Finding sessions

Use the bundled helper:

```bash
./scripts/find-sessions.sh -S "$SOCKET"
./scripts/find-sessions.sh --all
```

## Sending input safely

Prefer literal sends:

```bash
tmux -S "$SOCKET" send-keys -t "$TARGET" -l -- "$cmd"
tmux -S "$SOCKET" send-keys -t "$TARGET" Enter
```

Control keys:

```bash
tmux -S "$SOCKET" send-keys -t "$TARGET" C-c
tmux -S "$SOCKET" send-keys -t "$TARGET" C-d
tmux -S "$SOCKET" send-keys -t "$TARGET" Escape
```

## Cleanup

```bash
tmux -S "$SOCKET" kill-session -t "$SESSION"
tmux -S "$SOCKET" kill-server
```

For worker worktrees, do not delete worktrees automatically unless the user asks. Summarize branch/path/session state first.

## Red flags

Never:

- create a nested worktree when already in a linked worktree
- confuse submodules for linked worktrees
- create project-local worktrees without verifying they are ignored
- hardcode pane target indices
- leave the user without monitor/capture commands
- use a worker worktree for a simple handoff/continuation unless requested
