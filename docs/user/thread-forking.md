# Forking a thread

Use `/fork` when you want to explore another direction without changing the current conversation.
Type `/fork` by itself in the composer and send it. T3 Code creates a new thread named after the
source with `(fork)` appended, then opens it.

The new thread starts from the provider's current conversation state. It includes the completed
messages and visible activity from the source, but it does not copy historical checkpoint diffs,
pending approvals or questions, or an actionable plan from an earlier turn.

## Supported providers

Thread forking is available for:

- Codex
- Claude Agent
- OpenCode

Cursor and Grok do not currently support it. The `/fork` suggestion appears only when both the
connected server and the provider bound to the thread support forking.

## When a thread can be forked

The source must be a saved, unarchived thread with a resumable provider session. It must not have a
turn starting, running, or queued, and it cannot be waiting for an approval or an answer to a
question. Finish or resolve that work first, then try again.

`/fork` only acts as a command when it is the entire composer text, apart from surrounding spaces,
and there are no attachments or other composer context. Text such as `/fork try another approach`
is sent to the provider as a normal message.

If the provider cannot create the fork, T3 Code leaves the source unchanged and does not create a
new thread. The command stays in the composer so you can retry.

## Shared files and separate conversations

The source and target use the same project, branch, checkout, and worktree. File changes made from
either thread are immediately visible to the other. Forking is therefore useful for branching the
conversation, not for isolating filesystem changes.

The provider session itself is separate, so either conversation can receive later prompts without
changing the other's transcript. The target gets its own checkpoint baseline at the fork point;
earlier checkpoint history and turn diffs remain only on the source.

The target starts in the active thread list even if the copied messages are old. After its first new
turn, it follows the normal automatic settlement behavior.
