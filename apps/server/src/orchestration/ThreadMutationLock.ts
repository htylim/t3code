import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

interface LockEntry {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

const locks = new Map<string, LockEntry>();
const projectMutationLock = Semaphore.makeUnsafe(1);

export function withProjectMutationLock<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return projectMutationLock.withPermit(effect);
}

export function withThreadMutationLock<A, E, R>(
  threadId: ThreadId,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const existing = locks.get(threadId);
      if (existing !== undefined) {
        existing.users += 1;
        return existing;
      }
      const created = { semaphore: Semaphore.makeUnsafe(1), users: 1 };
      locks.set(threadId, created);
      return created;
    }),
    (entry) => entry.semaphore.withPermit(effect),
    (entry) =>
      Effect.sync(() => {
        entry.users -= 1;
        if (entry.users === 0 && locks.get(threadId) === entry) locks.delete(threadId);
      }),
  );
}
