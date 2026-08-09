import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { requireThreadControlCapability } from "./handlers.ts";

const invocation = (capabilities: McpInvocationContext.McpInvocationScope["capabilities"]) => ({
  environmentId: EnvironmentId.make("environment-thread-control-test"),
  threadId: ThreadId.make("thread-control-test"),
  providerSessionId: "provider-session-thread-control-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  maxRuntimeMode: "auto" as const,
  controlledThreadIds: new Set<ThreadId>(),
  issuedAt: 1,
});

it.effect("returns the stable capability error before later-phase behavior", () =>
  Effect.gen(function* () {
    const result = yield* requireThreadControlCapability("thread_context").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(new Set())),
      Effect.flip,
    );
    expect(result).toMatchObject({
      _tag: "ThreadControlError",
      code: "capability_denied",
      operation: "thread_context",
      environmentId: "environment-thread-control-test",
      callingThreadId: "thread-control-test",
    });
  }),
);

it.effect("accepts a provider credential with thread-control capability", () =>
  Effect.gen(function* () {
    const result = yield* requireThreadControlCapability("thread_context").pipe(
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        invocation(new Set(["thread-control"])),
      ),
    );
    expect(result.threadId).toBe("thread-control-test");
  }),
);
