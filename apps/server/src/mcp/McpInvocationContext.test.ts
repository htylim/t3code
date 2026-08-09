import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewAutomationUnavailableError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "./McpInvocationContext.ts";

it.effect("reports the scoped credential context when preview capability is unavailable", () => {
  const invocation: McpInvocationContext.McpInvocationScope = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
    capabilities: new Set(),
    maxRuntimeMode: "approval-required",
    controlledThreadIds: new Set(),
    issuedAt: 1,
  };

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("preview").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(PreviewAutomationUnavailableError);
    expect(error).toMatchObject({
      capability: "preview",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
    expect(error.message).toBe("MCP credential does not grant the preview capability.");
  });
});

it("orders runtime modes from supervised through full access", () => {
  expect(
    McpInvocationContext.runtimeModeIsWithinAuthority("approval-required", "approval-required"),
  ).toBe(true);
  expect(
    McpInvocationContext.runtimeModeIsWithinAuthority("auto-accept-edits", "approval-required"),
  ).toBe(false);
  expect(McpInvocationContext.runtimeModeIsWithinAuthority("auto-accept-edits", "auto")).toBe(true);
  expect(McpInvocationContext.runtimeModeIsWithinAuthority("auto", "auto-accept-edits")).toBe(
    false,
  );
  expect(McpInvocationContext.runtimeModeIsWithinAuthority("full-access", "auto")).toBe(false);
  expect(McpInvocationContext.runtimeModeIsWithinAuthority("auto", "full-access")).toBe(true);
});
