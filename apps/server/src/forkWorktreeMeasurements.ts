import type {
  ForkWorktreeMeasurement,
  ForkWorktreeMeasurementsInput,
  ForkWorktreeMeasurementsSnapshot,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as StorageCleanup from "./storageCleanup.ts";

const CACHE_CAPACITY = 256;
const FRESH_FOR_MS = 5 * 60_000;

interface CachedMeasurement {
  readonly measurement: ForkWorktreeMeasurement;
  readonly finishedAt: number | null;
}

/** Owns disposable size estimates and workers for all clients connected to this environment. */
export class ForkWorktreeMeasurements extends Context.Service<
  ForkWorktreeMeasurements,
  {
    readonly subscribe: (
      input: ForkWorktreeMeasurementsInput,
    ) => Stream.Stream<ForkWorktreeMeasurementsSnapshot>;
  }
>()("t3/forkWorktreeMeasurements") {}

const make = Effect.gen(function* () {
  const storageCleanup = yield* StorageCleanup.StorageCleanup;
  const path = yield* Path.Path;
  const cache = new Map<string, CachedMeasurement>();
  const mutex = yield* Semaphore.make(1);
  const changes = yield* Effect.acquireRelease(PubSub.sliding<void>(1), PubSub.shutdown);

  /** Publish state and its notification atomically with subscription snapshots. */
  const update = Effect.fn("ForkWorktreeMeasurements.update")(function* (
    key: string,
    entry: CachedMeasurement,
  ) {
    yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        cache.set(key, entry);
        yield* PubSub.publish(changes, undefined);
      }),
    );
  });

  /** Validate through the existing linked-worktree reader before scanning any filesystem path. */
  const measure = Effect.fn("ForkWorktreeMeasurements.measure")(function* (key: string) {
    const queued = cache.get(key)!;
    yield* update(key, {
      measurement: { ...queued.measurement, state: "measuring" },
      finishedAt: null,
    });
    const size = yield* Effect.suspend(() =>
      storageCleanup.getWorktreeSize(queued.measurement),
    ).pipe(
      Effect.timeout("35 seconds"),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    const available = size?.isLinkedWorktree === true && size.reclaimableBytes !== null;
    yield* update(key, {
      measurement: {
        cwd: queued.measurement.cwd,
        path: queued.measurement.path,
        state: available ? "ready" : "unavailable",
        reclaimableBytes: size?.reclaimableBytes ?? null,
      },
      finishedAt: yield* Clock.currentTimeMillis,
    });
  });
  const workers = [yield* makeDrainableWorker(measure), yield* makeDrainableWorker(measure)];
  let nextWorker = 0;

  /** Return cached states immediately, then stream worker updates without holding an RPC open for a scan. */
  const subscribe = (input: ForkWorktreeMeasurementsInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const requested = new Map(
          input.worktrees.map((target) => {
            const cwd = path.resolve(target.cwd);
            const worktreePath = path.resolve(cwd, target.path);
            return [JSON.stringify([cwd, worktreePath]), { cwd, path: worktreePath }] as const;
          }),
        );
        const now = yield* Clock.currentTimeMillis;
        const queued: string[] = [];
        yield* mutex.withPermits(1)(
          Effect.sync(() => {
            for (const [key, target] of requested) {
              const existing = cache.get(key);
              if (
                existing !== undefined &&
                (existing.finishedAt === null || now - existing.finishedAt < FRESH_FOR_MS)
              )
                continue;
              if (existing === undefined && cache.size >= CACHE_CAPACITY) {
                for (const [cachedKey, cached] of cache) {
                  if (cached.finishedAt !== null) {
                    cache.delete(cachedKey);
                    break;
                  }
                }
                if (cache.size >= CACHE_CAPACITY) continue;
              }
              cache.set(key, {
                measurement: {
                  ...target,
                  state: "queued",
                  reclaimableBytes: existing?.measurement.reclaimableBytes ?? null,
                },
                finishedAt: null,
              });
              queued.push(key);
            }
          }),
        );
        const snapshot = Effect.sync((): ForkWorktreeMeasurementsSnapshot => ({
          worktrees: Array.from(
            requested,
            ([key, target]) =>
              cache.get(key)?.measurement ?? {
                ...target,
                state: "unavailable",
                reclaimableBytes: null,
              },
          ),
        }));
        const subscription = yield* mutex.withPermits(1)(
          Effect.gen(function* () {
            const updates = yield* PubSub.subscribe(changes);
            return { latest: yield* snapshot, changes: Stream.fromSubscription(updates) };
          }),
        );
        for (const key of queued) {
          const worker = workers[nextWorker]!;
          nextWorker = (nextWorker + 1) % workers.length;
          yield* worker.enqueue(key);
        }
        return Stream.concat(
          Stream.make(subscription.latest),
          subscription.changes.pipe(Stream.mapEffect(() => mutex.withPermits(1)(snapshot))),
        ).pipe(
          Stream.changesWith(
            (
              previous: ForkWorktreeMeasurementsSnapshot,
              current: ForkWorktreeMeasurementsSnapshot,
            ) =>
              previous.worktrees.length === current.worktrees.length &&
              previous.worktrees.every((entry, index) => {
                const next = current.worktrees[index]!;
                return (
                  entry.cwd === next.cwd &&
                  entry.path === next.path &&
                  entry.state === next.state &&
                  entry.reclaimableBytes === next.reclaimableBytes
                );
              }),
          ),
        );
      }).pipe(Effect.uninterruptible),
    );

  return ForkWorktreeMeasurements.of({ subscribe });
});

export const layer = Layer.effect(ForkWorktreeMeasurements, make);
