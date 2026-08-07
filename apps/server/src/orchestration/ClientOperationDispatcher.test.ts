import {
  CommandId,
  ThreadId,
  type OrchestrationCommand,
  type ThreadForkOperation,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { dispatchClientOperation } from "./ClientOperationDispatcher.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ThreadForkService } from "./Services/ThreadForkService.ts";

const createdAt = "2026-08-06T12:00:00.000Z";

it("shared dispatcher routes thread.fork to ThreadForkService and not OrchestrationEngine", async () => {
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
  const fork = vi.fn(() => Effect.succeed({ sequence: 9 }));
  const operation: ThreadForkOperation = {
    type: "thread.fork",
    commandId: CommandId.make("command-fork"),
    sourceThreadId: ThreadId.make("thread-source"),
    threadId: ThreadId.make("thread-target"),
    createdAt,
  };

  const result = await Effect.runPromise(
    dispatchClientOperation(operation).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(OrchestrationEngineService, {
            dispatch,
            readEvents: () => {
              throw new Error("unused");
            },
            streamDomainEvents: undefined as never,
            latestSequence: Effect.succeed(0),
          }),
          Layer.succeed(ThreadForkService, { fork }),
        ),
      ),
    ),
  );

  expect(result).toEqual({ sequence: 9 });
  expect(fork).toHaveBeenCalledWith(operation);
  expect(dispatch).not.toHaveBeenCalled();
});

it("shared dispatcher routes ordinary commands to OrchestrationEngine", async () => {
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 4 }));
  const fork = vi.fn(() => Effect.succeed({ sequence: 9 }));
  const command: OrchestrationCommand = {
    type: "thread.delete",
    commandId: CommandId.make("command-delete"),
    threadId: ThreadId.make("thread-source"),
  };

  const result = await Effect.runPromise(
    dispatchClientOperation(command).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(OrchestrationEngineService, {
            dispatch,
            readEvents: () => {
              throw new Error("unused");
            },
            streamDomainEvents: undefined as never,
            latestSequence: Effect.succeed(0),
          }),
          Layer.succeed(ThreadForkService, { fork }),
        ),
      ),
    ),
  );

  expect(result).toEqual({ sequence: 4 });
  expect(dispatch).toHaveBeenCalledWith(command);
  expect(fork).not.toHaveBeenCalled();
});
