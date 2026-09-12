import { deleteSession, getSessionInfo, listSubagents } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeOS from "node:os";

import { TransientChatProviderThreadDeleteError } from "./errors.ts";

// getSessionInfo also returns undefined for unreadable or unrecognizable history.
// Only accept absence after a filesystem check. Searching every project is
// conservative when the configured cwd or SDK project encoding changed.
const confirmAbsent = Effect.fn("confirmClaudeSessionAbsent")(function* (id: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(NodeOS.homedir(), ".claude"),
    "projects",
  );
  const directories = yield* fs
    .readDirectory(projects)
    .pipe(
      Effect.catch((error) =>
        error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error),
      ),
    );
  for (const directory of directories) {
    const root = path.join(projects, directory);
    const stat = yield* fs.stat(root);
    if (stat.type !== "Directory") continue;
    const exists = yield* fs.stat(path.join(root, `${id}.jsonl`)).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(error),
      ),
    );
    if (exists) return false;
  }
  return true;
});

/** Run in the isolated worker: SDK history helpers read process.env. */
export const deleteClaudeTransientThread = Effect.fn("deleteClaudeTransientThread")(function* (
  providerSessionId: string,
  directory: string,
  allowMissing = false,
) {
  const options = { dir: directory };
  const session = yield* Effect.tryPromise(() => getSessionInfo(providerSessionId, options));
  if (!session || session.sessionId !== providerSessionId) {
    if (allowMissing && (yield* confirmAbsent(providerSessionId))) return "already-absent" as const;
    return yield* new TransientChatProviderThreadDeleteError({
      provider: "claudeAgent",
      providerSessionId,
      reason: "invalid-target",
      message: "The Claude root session was not found in the selected provider home and project.",
    });
  }
  const children = yield* Effect.tryPromise(() => listSubagents(providerSessionId, options));
  if (children.length > 0) {
    return yield* new TransientChatProviderThreadDeleteError({
      provider: "claudeAgent",
      providerSessionId,
      reason: "unsafe-session",
      message: "The Claude session has subagent transcripts.",
    });
  }
  // Claude root forks are independent transcript copies. This SDK operation
  // removes only the selected root and its own subdirectory, never its source.
  yield* Effect.tryPromise(() => deleteSession(providerSessionId, options));
  if (yield* Effect.tryPromise(() => getSessionInfo(providerSessionId, options))) {
    return yield* new TransientChatProviderThreadDeleteError({
      provider: "claudeAgent",
      providerSessionId,
      reason: "provider-error",
      message: "Claude still lists the session after deletion.",
    });
  }
  return "deleted" as const;
});
