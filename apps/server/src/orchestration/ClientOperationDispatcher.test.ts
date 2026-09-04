import {
  CommandId,
  ThreadId,
  type OrchestrationCommand,
  type ThreadForkOperation,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { dispatchClientOperation } from "./ClientOperationDispatcher.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ThreadForkService } from "./Services/ThreadForkService.ts";

const createdAt = "2026-08-06T12:00:00.000Z";

it.effect(
  "shared dispatcher routes thread.fork to ThreadForkService and not OrchestrationEngine",
  () =>
    Effect.gen(function* () {
      const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
      const fork = vi.fn(() => Effect.succeed({ sequence: 9 }));
      const operation: ThreadForkOperation = {
        type: "thread.fork",
        commandId: CommandId.make("command-fork"),
        sourceThreadId: ThreadId.make("thread-source"),
        threadId: ThreadId.make("thread-target"),
        createdAt,
      };

      const result = yield* dispatchClientOperation(operation).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(OrchestrationEngineService, {
              dispatch,
              readEvents: () => {
                throw new Error("unused");
              },
              readThreadEvents: () => Stream.empty,
              getThreadReplayStats: () =>
                Effect.succeed({ eventCount: 0, payloadBytes: 0, hasCreateEvent: false }),
              streamDomainEvents: Stream.empty,
              subscribeDomainEvents: Effect.succeed(Stream.empty),
              latestSequence: Effect.succeed(0),
            }),
            Layer.succeed(ThreadForkService, { fork }),
          ),
        ),
      );

      expect(result).toEqual({ sequence: 9 });
      expect(fork).toHaveBeenCalledWith(operation);
      expect(dispatch).not.toHaveBeenCalled();
    }),
);

it.effect("shared dispatcher routes ordinary commands to OrchestrationEngine", () =>
  Effect.gen(function* () {
    const dispatch = vi.fn(() => Effect.succeed({ sequence: 4 }));
    const fork = vi.fn(() => Effect.succeed({ sequence: 9 }));
    const command: OrchestrationCommand = {
      type: "thread.delete",
      commandId: CommandId.make("command-delete"),
      threadId: ThreadId.make("thread-source"),
    };

    const result = yield* dispatchClientOperation(command).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(OrchestrationEngineService, {
            dispatch,
            readEvents: () => {
              throw new Error("unused");
            },
            readThreadEvents: () => Stream.empty,
            getThreadReplayStats: () =>
              Effect.succeed({ eventCount: 0, payloadBytes: 0, hasCreateEvent: false }),
            streamDomainEvents: Stream.empty,
            subscribeDomainEvents: Effect.succeed(Stream.empty),
            latestSequence: Effect.succeed(0),
          }),
          Layer.succeed(ThreadForkService, { fork }),
        ),
      ),
    );

    expect(result).toEqual({ sequence: 4 });
    expect(dispatch).toHaveBeenCalledWith(command);
    expect(fork).not.toHaveBeenCalled();
  }),
);
