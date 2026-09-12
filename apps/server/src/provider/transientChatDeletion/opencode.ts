import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TransientChatProviderThreadDeleteError } from "./errors.ts";

const decodeSession = Schema.decodeUnknownEffect(
  Schema.Struct({ id: Schema.String, parentID: Schema.optionalKey(Schema.String) }),
);
const decodeChildren = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown));
const decodeStatuses = Schema.decodeUnknownEffect(
  Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
);

export const deleteOpenCodeTransientThread = Effect.fn("deleteOpenCodeTransientThread")(function* (
  client: OpencodeClient,
  providerSessionId: string,
  directory: string,
  allowMissing = false,
) {
  const unsafe = (message: string) =>
    new TransientChatProviderThreadDeleteError({
      provider: "opencode",
      providerSessionId,
      reason: "unsafe-session",
      message,
    });
  const target = { sessionID: providerSessionId, directory };
  const before = yield* Effect.tryPromise((signal) =>
    client.session.get(target, { signal, throwOnError: false }),
  );
  if (allowMissing && before.response.status === 404) return "already-absent" as const;
  const session = yield* decodeSession(before.data);
  if (session.id !== providerSessionId || session.parentID !== undefined) {
    return yield* unsafe("Only a standalone OpenCode session can be deleted.");
  }
  const children = yield* Effect.tryPromise((signal) =>
    client.session.children(target, { signal, throwOnError: true }),
  ).pipe(Effect.flatMap((result) => decodeChildren(result.data)));
  if (children.length > 0) {
    return yield* unsafe("The OpenCode session has child sessions.");
  }
  const statuses = yield* Effect.tryPromise((signal) =>
    client.session.status({ directory }, { signal, throwOnError: true }),
  ).pipe(Effect.flatMap((result) => decodeStatuses(result.data)));
  const status = statuses[providerSessionId];
  if (status !== undefined && status.type !== "idle") {
    return yield* unsafe("The OpenCode session must be stopped before deletion.");
  }
  yield* Effect.tryPromise((signal) =>
    client.session.delete(target, { signal, throwOnError: true }),
  );
  // Some OpenCode versions log deletion failures without failing the request.
  const after = yield* Effect.tryPromise((signal) =>
    client.session.get(target, { signal, throwOnError: false }),
  );
  if (after.response.status !== 404) {
    return yield* new TransientChatProviderThreadDeleteError({
      provider: "opencode",
      providerSessionId,
      reason: "provider-error",
      message: "OpenCode did not confirm that the session was deleted.",
    });
  }
  return "deleted" as const;
});
