import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { assertTransientChatNotClosing, makeTransientChatCleanupGate } from "./lifecycle.ts";

const id = ThreadId.make("transient");

it.effect("cleanup waits for admission, rejects new work, and leaves other threads usable", () =>
  Effect.gen(function* () {
    const gate = yield* makeTransientChatCleanupGate;
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const deleting = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const start = yield* gate
      .run(id, Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))))
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const cleanup = yield* gate
      .cleanup(
        id,
        Deferred.succeed(deleting, undefined).pipe(Effect.andThen(Deferred.await(finish))),
      )
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.isUndefined(cleanup.pollUnsafe());
    yield* Effect.flip(gate.run(id, Effect.void));
    yield* gate.run(ThreadId.make("unrelated"), Effect.void);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(start);
    yield* Deferred.await(deleting);
    yield* Effect.flip(gate.cleanup(id, Effect.void));
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(cleanup);
  }),
);

it.effect("interrupted admission releases cleanup; failed cleanup releases the gate", () =>
  Effect.gen(function* () {
    const gate = yield* makeTransientChatCleanupGate;
    const started = yield* Deferred.make<void>();
    const start = yield* gate
      .run(id, Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(start);
    yield* Effect.flip(gate.cleanup(id, Effect.fail("failed")));
    yield* gate.run(id, Effect.void);
    yield* gate.cleanup(id, Effect.void);
  }),
);

it.effect("persisted cleanup markers prohibit recovery after the gate or server restarts", () =>
  Effect.gen(function* () {
    for (const transientSideChatCleanup of ["pending", "complete"]) {
      yield* Effect.flip(assertTransientChatNotClosing(id, { transientSideChatCleanup }));
    }
    yield* assertTransientChatNotClosing(id, { cwd: "/repo" });
    yield* assertTransientChatNotClosing(id, undefined);
  }),
);
