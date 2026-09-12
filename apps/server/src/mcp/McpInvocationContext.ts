import {
  type EnvironmentId,
  McpCapabilityUnavailableError,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability = "preview" | "device" | "pull-requests" | "thread-control";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly maxRuntimeMode: RuntimeMode;
  readonly controlledThreadIds: ReadonlySet<ThreadId>;
  readonly issuedAt: number;
}

const runtimeModeAuthority: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

export const runtimeModeIsWithinAuthority = (
  requested: RuntimeMode,
  maximum: RuntimeMode,
): boolean => runtimeModeAuthority[requested] <= runtimeModeAuthority[maximum];

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

/** The error a missing capability surfaces as; preview keeps its own so the broker can route it. */
export type McpCapabilityError<C extends McpCapability> = C extends "preview"
  ? PreviewAutomationUnavailableError
  : McpCapabilityUnavailableError;

const missingCapability = (
  invocation: McpInvocationScope,
  capability: McpCapability,
): PreviewAutomationUnavailableError | McpCapabilityUnavailableError => {
  const fields = {
    environmentId: invocation.environmentId,
    threadId: invocation.threadId,
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  };
  return capability === "preview"
    ? new PreviewAutomationUnavailableError({ capability, ...fields })
    : new McpCapabilityUnavailableError({ capability, ...fields });
};

export const requireMcpCapability = <const C extends McpCapability>(
  capability: C,
): Effect.Effect<McpInvocationScope, McpCapabilityError<C>, McpInvocationContext> =>
  Effect.flatMap(McpInvocationContext, (invocation) =>
    invocation.capabilities.has(capability)
      ? Effect.succeed(invocation)
      : // The conditional type narrows what the literal argument decided at runtime.
        Effect.fail(missingCapability(invocation, capability) as McpCapabilityError<C>),
  ).pipe(Effect.withSpan("mcp.requireCapability"));
