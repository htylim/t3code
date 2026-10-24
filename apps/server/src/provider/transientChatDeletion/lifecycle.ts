import { TransientSideChatCleanupError, type ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const isClosingPayload = Schema.is(
  Schema.Struct({
    transientSideChatCleanup: Schema.Literals(["pending", "complete"]),
  }),
);

export const assertTransientChatNotClosing = (threadId: ThreadId, payload: unknown) =>
  isClosingPayload(payload)
    ? Effect.fail(
        new TransientSideChatCleanupError({
          reason: "busy",
          message: `Transient side chat '${threadId}' is being deleted.`,
        }),
      )
    : Effect.void;

/** Tracks admission calls, not the lifetime of model turns. Normal deletion does not use this gate. */
export const makeTransientChatCleanupGate = Effect.sync(() => {
  const pending = new Map<ThreadId, Set<Deferred.Deferred<void>>>();
  const closing = new Set<ThreadId>();

  /** Hold an admission slot until this operation and its finalizers finish. */
  const run = Effect.fn("TransientChatCleanupGate.run")(function* <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) {
    if (closing.has(threadId)) {
      return yield* new TransientSideChatCleanupError({
        reason: "busy",
        message: `Transient side chat '${threadId}' is being deleted.`,
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

  /** Block new admissions and wait for existing operations before deleting history. */
  const cleanup = Effect.fn("TransientChatCleanupGate.cleanup")(function* <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) {
    if (closing.has(threadId)) {
      return yield* new TransientSideChatCleanupError({
        reason: "busy",
        message: `Cleanup for '${threadId}' is already in progress.`,
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

/** One server process shares admission state between V2 turn starts and cleanup RPCs. */
export const transientChatCleanupGate = Effect.runSync(makeTransientChatCleanupGate);
