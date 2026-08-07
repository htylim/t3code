import { CommandId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { dispatchHttpClientOperation } from "./http.ts";
import { ThreadForkService } from "./Services/ThreadForkService.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import * as Stream from "effect/Stream";

it("HTTP dispatch routes thread.fork through the shared dispatcher with operate scope", async () => {
  const fork = vi.fn(() => Effect.succeed({ sequence: 12 }));
  const operation = {
    type: "thread.fork" as const,
    commandId: CommandId.make("command-http-fork"),
    sourceThreadId: ThreadId.make("thread-source"),
    threadId: ThreadId.make("thread-target"),
    createdAt: "2026-08-06T12:00:00.000Z",
  };

  const result = await Effect.runPromise(
    dispatchHttpClientOperation(operation).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ThreadForkService, { fork }),
          Layer.succeed(OrchestrationEngineService, {
            dispatch: () => Effect.succeed({ sequence: 0 }),
            readEvents: () => Stream.empty,
            streamDomainEvents: Stream.empty,
            latestSequence: Effect.succeed(0),
          }),
        ),
      ),
    ),
  );

  expect(result).toEqual({ sequence: 12 });
  expect(fork).toHaveBeenCalledWith(operation);
});
