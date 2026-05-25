/**
 * Git safety interceptor for agent-driven bash commands.
 *
 * This extension applies two guardrails when the assistant calls the bash tool
 * with a command that appears to use git:
 *
 * 1. Prevent interactive editor hangs:
 *    - GIT_EDITOR=true makes git treat the editor command as a successful no-op.
 *    - GIT_SEQUENCE_EDITOR=true does the same for sequence-editing operations such
 *      as interactive rebase todo editing.
 *    - GIT_MERGE_AUTOEDIT=no tells git not to open an editor for merge commit
 *      messages automatically.
 *
 *    Together, these keep non-interactive agent bash calls from hanging in vim,
 *    nvim, or another terminal editor.
 *
 * 2. Block --no-verify:
 *    Agents should not bypass repository hooks. If a hook fails, the agent should
 *    fix the underlying issue or ask the user for help.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const GIT_ENV_PREFIX =
  "export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no\n";

const NO_VERIFY_RE = /--no-verify\b/;

const BLOCK_REASON =
  "BLOCKED: --no-verify is not allowed. Git hooks exist for a reason. " +
  "Do not bypass hooks. Fix the hook failure or ask the user for help.";

function looksLikeGitCommand(command: string): boolean {
  return /(^|[;&|()\s])git(\s|$)/.test(command);
}

export default function gitInterceptor(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!looksLikeGitCommand(event.input.command)) return;

    if (NO_VERIFY_RE.test(event.input.command)) {
      return { block: true, reason: BLOCK_REASON };
    }

    if (!event.input.command.includes("GIT_EDITOR=true")) {
      event.input.command = GIT_ENV_PREFIX + event.input.command;
    }
  });
}
