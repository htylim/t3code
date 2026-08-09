import * as Effect from "effect/Effect";

import { ThreadControlService } from "../../ThreadControlService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadControlError, type ThreadControlOperation } from "./schemas.ts";
import { ThreadControlToolkit } from "./tools.ts";

export const requireThreadControlCapability = Effect.fn("ThreadControlToolkit.requireCapability")(
  function* (operation: ThreadControlOperation) {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    if (!invocation.capabilities.has("thread-control")) {
      return yield* new ThreadControlError({
        code: "capability_denied",
        operation,
        message: "MCP credential does not grant the thread-control capability.",
        retryable: false,
        environmentId: invocation.environmentId,
        callingThreadId: invocation.threadId,
        providerSessionId: invocation.providerSessionId,
        providerInstanceId: invocation.providerInstanceId,
      });
    }
    return invocation;
  },
);

const handlers = {
  thread_context: () =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_context");
      const service = yield* ThreadControlService;
      return yield* service.threadContext(invocation);
    }),
  models_list: (input) =>
    Effect.gen(function* () {
      yield* requireThreadControlCapability("models_list");
      const service = yield* ThreadControlService;
      return yield* service.modelsList(input);
    }),
  threads_list: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("threads_list");
      const service = yield* ThreadControlService;
      return yield* service.threadsList(invocation, input);
    }),
  thread_status: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_status");
      const service = yield* ThreadControlService;
      return yield* service.threadStatus(invocation, input.threadId);
    }),
  threads_wait: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("threads_wait");
      const service = yield* ThreadControlService;
      return yield* service.threadsWait(invocation, input);
    }),
  thread_read: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_read");
      const service = yield* ThreadControlService;
      return yield* service.threadRead(invocation, input);
    }),
  thread_start: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_start");
      const service = yield* ThreadControlService;
      return yield* service.threadStart(invocation, input);
    }),
  thread_send: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_send");
      const service = yield* ThreadControlService;
      return yield* service.threadSend(invocation, input);
    }),
  thread_interrupt: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_interrupt");
      const service = yield* ThreadControlService;
      return yield* service.threadInterrupt(invocation, input);
    }),
  thread_update: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireThreadControlCapability("thread_update");
      const service = yield* ThreadControlService;
      return yield* service.threadUpdate(invocation, input);
    }),
} satisfies Parameters<typeof ThreadControlToolkit.toLayer>[0];

export const ThreadControlToolkitHandlersLive = ThreadControlToolkit.toLayer(handlers);
