import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  GitCommandError,
  type ForkWorktreeSizeInput,
  type ForkWorktreeSizeResult,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Measurements from "./forkWorktreeMeasurements.ts";
import * as StorageCleanup from "./storageCleanup.ts";

/** Hold each synthetic scan on a gate so tests observe queue and stream milestones without sleeps. */
const fixture = Effect.fn("ForkWorktreeMeasurements.testFixture")(function* () {
  const started = yield* Queue.unbounded<{
    target: ForkWorktreeSizeInput;
    completion: Deferred.Deferred<ForkWorktreeSizeResult, GitCommandError>;
  }>();
  const interrupted = yield* Queue.unbounded<string>();
  const calls: string[] = [];
  const context = yield* Layer.build(
    Measurements.layer.pipe(
      Layer.provide(
        Layer.mock(StorageCleanup.StorageCleanup)({
          getWorktreeSize: (target) =>
            Effect.gen(function* () {
              calls.push(target.path);
              const completion = yield* Deferred.make<ForkWorktreeSizeResult, GitCommandError>();
              yield* Queue.offer(started, { target, completion });
              return yield* Deferred.await(completion).pipe(
                Effect.onInterrupt(() => Queue.offer(interrupted, target.path)),
              );
            }),
        }),
      ),
      Layer.provide(NodeServices.layer),
    ),
  );
  const service = Context.get(context, Measurements.ForkWorktreeMeasurements);
  return { service, started, interrupted, calls };
});

const input = {
  worktrees: ["a", "b", "c"].map((name) => ({ cwd: "/repo", path: `/trees/${name}` })),
};
const size = { isLinkedWorktree: true, reclaimableBytes: 4096 };

it.effect(
  "sends an immediate snapshot, bounds concurrency, and deduplicates overlapping clients",
  () =>
    Effect.gen(function* () {
      const { service, started, calls } = yield* fixture();
      const first = yield* service.subscribe(input).pipe(Stream.runHead);
      expect(Option.getOrThrow(first).worktrees.map((entry) => entry.state)).toEqual([
        "queued",
        "queued",
        "queued",
      ]);
      const firstScan = yield* Queue.take(started);
      const secondScan = yield* Queue.take(started);
      expect(calls).toHaveLength(2);
      const overlapping = yield* service.subscribe(input).pipe(Stream.runHead);
      expect(Option.getOrThrow(overlapping).worktrees.map((entry) => entry.state)).toEqual([
        "measuring",
        "measuring",
        "queued",
      ]);
      expect(calls).toHaveLength(2);
      yield* Deferred.succeed(firstScan.completion, size);
      yield* Deferred.succeed(secondScan.completion, size);
      const thirdScan = yield* Queue.take(started);
      yield* Deferred.succeed(thirdScan.completion, size);
      const complete = yield* service.subscribe(input).pipe(
        Stream.filter((snapshot) => snapshot.worktrees.every((entry) => entry.state === "ready")),
        Stream.runHead,
      );
      expect(Option.getOrThrow(complete).worktrees.map((entry) => entry.reclaimableBytes)).toEqual([
        4096, 4096, 4096,
      ]);
      yield* service.subscribe(input).pipe(Stream.runHead);
      expect(calls).toHaveLength(3);
    }).pipe(Effect.scoped),
);

it.effect(
  "retains cached bytes while stale scans refresh and keeps work shared after unsubscribe",
  () =>
    Effect.gen(function* () {
      const { service, started, calls } = yield* fixture();
      const single = { worktrees: [input.worktrees[0]!] };
      yield* service.subscribe(single).pipe(Stream.runHead);
      const scan = yield* Queue.take(started);
      yield* Deferred.succeed(scan.completion, size);
      yield* service.subscribe(single).pipe(
        Stream.filter((snapshot) => snapshot.worktrees[0]?.state === "ready"),
        Stream.runHead,
      );
      yield* TestClock.adjust("5 minutes");
      const stale = yield* service.subscribe(single).pipe(Stream.runHead);
      expect(Option.getOrThrow(stale).worktrees[0]).toMatchObject({
        state: "queued",
        reclaimableBytes: 4096,
      });
      const refresh = yield* Queue.take(started);
      yield* Deferred.succeed(refresh.completion, { ...size, reclaimableBytes: 8192 });
      const updated = yield* service.subscribe(single).pipe(
        Stream.filter((snapshot) => snapshot.worktrees[0]?.state === "ready"),
        Stream.runHead,
      );
      expect(Option.getOrThrow(updated).worktrees[0]?.reclaimableBytes).toBe(8192);
      expect(calls).toHaveLength(2);
    }).pipe(Effect.scoped),
);

it.effect(
  "reports scan errors and unregistered targets without terminating other measurements",
  () =>
    Effect.gen(function* () {
      const { service, started } = yield* fixture();
      yield* service.subscribe(input).pipe(Stream.runHead);
      const failed = yield* Queue.take(started);
      const missing = yield* Queue.take(started);
      yield* Deferred.fail(
        failed.completion,
        new GitCommandError({
          operation: "test",
          command: "git",
          cwd: "/repo",
          detail: "synthetic failure",
        }),
      );
      yield* Deferred.succeed(missing.completion, {
        isLinkedWorktree: false,
        reclaimableBytes: null,
      });
      const valid = yield* Queue.take(started);
      yield* Deferred.succeed(valid.completion, size);
      const complete = yield* service.subscribe(input).pipe(
        Stream.filter((snapshot) =>
          snapshot.worktrees.every(
            (entry) => entry.state === "ready" || entry.state === "unavailable",
          ),
        ),
        Stream.runHead,
      );
      expect(Option.getOrThrow(complete).worktrees.map((entry) => entry.state)).toEqual([
        "unavailable",
        "unavailable",
        "ready",
      ]);
    }).pipe(Effect.scoped),
);

it.effect("times out a stuck scan and frees the worker for queued work", () =>
  Effect.gen(function* () {
    const { service, started, interrupted } = yield* fixture();
    yield* service.subscribe(input).pipe(Stream.runHead);
    yield* Queue.take(started);
    yield* Queue.take(started);
    yield* TestClock.adjust("35 seconds");
    const third = yield* Queue.take(started);
    expect(third.target.path).toBe("/trees/c");
    yield* Deferred.succeed(third.completion, size);
    const complete = yield* service.subscribe(input).pipe(
      Stream.filter((snapshot) =>
        snapshot.worktrees.every(
          (entry) => entry.state === "ready" || entry.state === "unavailable",
        ),
      ),
      Stream.runHead,
    );
    expect(Option.getOrThrow(complete).worktrees.map((entry) => entry.state)).toEqual([
      "unavailable",
      "unavailable",
      "ready",
    ]);
    expect([yield* Queue.take(interrupted), yield* Queue.take(interrupted)].sort()).toEqual([
      "/trees/a",
      "/trees/b",
    ]);
  }).pipe(Effect.scoped),
);

it.effect("bounds queued work across subscribers without evicting in-flight scans", () =>
  Effect.gen(function* () {
    const { service, started, calls } = yield* fixture();
    const full = {
      worktrees: Array.from({ length: 256 }, (_, index) => ({
        cwd: "/repo",
        path: `/trees/${index}`,
      })),
    };
    yield* service.subscribe(full).pipe(Stream.runHead);
    yield* Queue.take(started);
    yield* Queue.take(started);
    const overflow = yield* service.subscribe(input).pipe(Stream.runHead);
    expect(
      Option.getOrThrow(overflow).worktrees.every((entry) => entry.state === "unavailable"),
    ).toBe(true);
    expect(calls).toHaveLength(2);
    const existing = yield* service
      .subscribe({ worktrees: [full.worktrees[0]!] })
      .pipe(Stream.runHead);
    expect(Option.getOrThrow(existing).worktrees[0]?.state).toBe("measuring");
  }).pipe(Effect.scoped),
);

it.effect("stops active scans and drops queued work when the service closes", () =>
  Effect.gen(function* () {
    const workerScope = yield* Scope.make();
    const { service, started, interrupted, calls } = yield* fixture().pipe(
      Effect.provideService(Scope.Scope, workerScope),
    );
    yield* service.subscribe(input).pipe(Stream.runHead);
    yield* Queue.take(started);
    yield* Queue.take(started);
    yield* Scope.close(workerScope, Exit.void);
    expect([yield* Queue.take(interrupted), yield* Queue.take(interrupted)].sort()).toEqual([
      "/trees/a",
      "/trees/b",
    ]);
    expect(calls).toHaveLength(2);
  }).pipe(Effect.scoped),
);
