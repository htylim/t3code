import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ProviderValidationError } from "../Errors.ts";

const isClosingPayload = Schema.is(
  Schema.Struct({
    transientSideChatCleanup: Schema.Literals(["pending", "complete"]),
  }),
);

export const assertTransientChatNotClosing = (threadId: ThreadId, payload: unknown) =>
  isClosingPayload(payload)
    ? Effect.fail(
        new ProviderValidationError({
          operation: "transient-side-chat-cleanup",
          issue: `Transient side chat '${threadId}' is being deleted.`,
        }),
      )
    : Effect.void;

/** Tracks admission calls, not the lifetime of model turns. Normal deletion does not use this gate. */
export const makeTransientChatCleanupGate = Effect.sync(() => {
  const pending = new Map<ThreadId, Set<Deferred.Deferred<void>>>();
  const closing = new Set<ThreadId>();

  const run = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (closing.has(threadId)) {
        return yield* new ProviderValidationError({
          operation: "transient-side-chat-cleanup",
          issue: `Transient side chat '${threadId}' is being deleted.`,
        });
      }
      const done = yield* Deferred.make<void>();
      const operations = pending.get(threadId) ?? new Set<Deferred.Deferred<void>>();
      operations.add(done);
      pending.set(threadId, operations);
      return yield* effect.pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            operations.delete(done);
            if (operations.size === 0) pending.delete(threadId);
            yield* Deferred.succeed(done, undefined);
          }),
        ),
      );
    });

  const cleanup = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      if (closing.has(threadId)) {
        return yield* new ProviderValidationError({
          operation: "transient-side-chat-cleanup",
          issue: `Cleanup for '${threadId}' is already in progress.`,
        });
      }
      closing.add(threadId);
      return yield* Effect.gen(function* () {
        yield* Effect.forEach(pending.get(threadId) ?? [], (done) => Deferred.await(done), {
          discard: true,
        });
        return yield* effect;
      }).pipe(Effect.ensuring(Effect.sync(() => closing.delete(threadId))));
    });

  return { run, cleanup };
});

export class TransientChatCleanupGate extends Context.Service<
  TransientChatCleanupGate,
  Effect.Success<typeof makeTransientChatCleanupGate>
>()("t3/provider/transientChatDeletion/lifecycle/TransientChatCleanupGate") {
  static readonly layer = Layer.effect(this, makeTransientChatCleanupGate);
}
