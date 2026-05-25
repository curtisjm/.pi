---
name: handoff-tmux
description: Hand off the current session context to a fresh Pi agent in a new tmux window in the same tmux session and same working directory. Use for context continuation, not independent delegated implementation work.
---

# handoff-tmux

Hand off the current conversation context to a fresh Pi agent in a new tmux window.

This is for **continuation/context transfer**. It is not the same as task delegation. Delegation workflows should use isolated worktrees by default; this skill defaults to the **same working directory**.

## Requirements

- Use the [tmux](../tmux/SKILL.md) conventions when controlling tmux.
- Default to the current working directory.
- Do not create a git worktree unless the user explicitly asks.
- Write a handoff document before starting the fresh agent.
- Redact secrets and do not include API keys, passwords, tokens, or private personal data.

## Workflow

### 1. Confirm tmux context

Check whether the current shell is inside tmux:

```bash
printf '%s\n' "${TMUX:-}"
tmux display-message -p '#S' 2>/dev/null || true
```

If already inside tmux, create a new window in the current tmux session.

If not inside tmux, ask the user whether to:

- create/use the private Pi tmux socket from the tmux skill, or
- stop and provide a handoff file only.

### 2. Write handoff file

Prefer a project-local handoff directory if it already exists:

```text
.pi/handoffs/
.ai/handoffs/
```

Otherwise use the OS temp directory.

Suggested filename:

```text
handoff-YYYYMMDD-HHMMSS-<slug>.md
```

The handoff should include:

- current goal
- important decisions already made
- files/issues/PRs/docs to read
- commands already run and their outcomes
- current working directory
- current git branch/status summary
- suggested skills for the fresh agent
- explicit next steps
- known risks/open questions

Do not duplicate full content that already exists in files, issues, PRDs, ADRs, or diffs. Link by path or URL.

### 3. Start fresh Pi in a new tmux window

Use the same working directory.

When inside an existing tmux session:

```bash
WINDOW="handoff-<slug>"
HANDOFF="/path/to/handoff.md"
CWD="$PWD"

tmux new-window -n "$WINDOW" -c "$CWD"
tmux send-keys -t "$WINDOW" -l -- "pi @${HANDOFF} 'Continue from this handoff. Read the handoff first, then summarize your understanding and ask for confirmation before making changes.'"
tmux send-keys -t "$WINDOW" Enter
```

If using the private Pi tmux socket instead, follow the socket conventions from the tmux skill and pass `-S "$SOCKET"` to every tmux command.

### 4. Report to the user

Always report:

```text
Handoff written: <handoff path>
Fresh Pi window: <tmux session/window>
Working directory: <cwd>

To attach:
  tmux attach -t <session>

To capture output:
  tmux capture-pane -p -J -t <session>:<window>.0 -S -200
```

Adjust commands if using a private `-S "$SOCKET"` tmux server.

## Do not

- use this skill for independent parallel implementation work
- create a worktree by default
- start the fresh agent before writing the handoff file
- omit monitor/attach commands
- include secrets in the handoff
