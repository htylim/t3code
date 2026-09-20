import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/unstable/cli";
import { runTransientChatDeletionWorker } from "../transientChatDeletionWorker.ts";

/** Runs the isolated Claude deletion worker inside a standalone executable. */
export const transientChatDeletionCommand = Command.make("__transient-chat-delete", {
  sessionId: Argument.String("session-id"),
  directory: Argument.String("directory"),
  allowMissing: Argument.String("allow-missing"),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ sessionId, directory, allowMissing }) =>
    Effect.promise(() => runTransientChatDeletionWorker([sessionId, directory, allowMissing])),
  ),
);
