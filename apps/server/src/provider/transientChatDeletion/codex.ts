import type { CodexAppServerClient } from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TransientChatProviderThreadDeleteError } from "./errors.ts";

const Thread = Schema.Struct({
  id: Schema.String,
  ephemeral: Schema.Boolean,
  parentThreadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  forkedFromId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  source: Schema.Unknown,
  status: Schema.Struct({ type: Schema.String }),
});
const decodeThread = Schema.decodeUnknownEffect(Schema.Struct({ thread: Thread }));
const decodeChildren = Schema.decodeUnknownEffect(
  Schema.Struct({
    data: Schema.Array(Schema.Unknown),
    nextCursor: Schema.NullOr(Schema.String),
  }),
);

/** Uses raw requests for descendant filters absent from the generated stable protocol. */
export const deleteCodexTransientThread = Effect.fn("deleteCodexTransientThread")(function* (
  client: Pick<CodexAppServerClient["Service"]["raw"], "request">,
  providerSessionId: string,
  allowMissing = false,
) {
  const unsafe = (message: string) =>
    new TransientChatProviderThreadDeleteError({
      provider: "codex",
      providerSessionId,
      reason: "unsafe-session",
      message,
    });
  const read = yield* client
    .request("thread/read", { threadId: providerSessionId, includeTurns: false })
    .pipe(
      Effect.flatMap(decodeThread),
      Effect.catchTag("CodexAppServerRequestError", (error) =>
        allowMissing &&
        error.code === -32600 &&
        [
          `thread not found: ${providerSessionId}`,
          `thread not loaded: ${providerSessionId}`,
          `no rollout found for thread id ${providerSessionId}`,
        ].includes(error.errorMessage)
          ? Effect.succeed(undefined)
          : Effect.fail(error),
      ),
    );
  if (read === undefined) return "already-absent" as const;
  const { thread } = read;
  if (
    thread.id !== providerSessionId ||
    thread.ephemeral ||
    thread.parentThreadId != null ||
    thread.forkedFromId != null ||
    !["cli", "vscode", "exec", "appServer"].includes(String(thread.source))
  ) {
    return yield* unsafe("Only a standalone persisted Codex thread can be deleted.");
  }
  if (thread.status.type !== "notLoaded" && thread.status.type !== "idle") {
    return yield* unsafe("The Codex thread must be stopped before deletion.");
  }
  for (const archived of [false, true]) {
    const children = yield* client
      .request("thread/list", {
        ancestorThreadId: providerSessionId,
        archived,
        limit: 1,
        modelProviders: [],
        sourceKinds: [
          "cli",
          "vscode",
          "exec",
          "appServer",
          "subAgent",
          "subAgentReview",
          "subAgentCompact",
          "subAgentThreadSpawn",
          "subAgentOther",
          "unknown",
        ],
      })
      .pipe(Effect.flatMap(decodeChildren));
    // Also refuse an incomplete response. A server ignoring the new filter may
    // reject a safe deletion, but must never cause an unchecked cascade.
    if (children.data.length > 0 || children.nextCursor !== null) {
      return yield* unsafe(
        "The Codex thread has descendants or their absence could not be established.",
      );
    }
  }
  yield* client.request("thread/delete", { threadId: providerSessionId });
  return "deleted" as const;
});
