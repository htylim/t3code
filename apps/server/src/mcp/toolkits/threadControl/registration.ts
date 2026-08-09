import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { AiError, McpSchema, McpServer, Tool } from "effect/unstable/ai";

import * as ThreadControlService from "../../ThreadControlService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadControlToolkitHandlersLive } from "./handlers.ts";
import {
  ThreadControlError,
  ThreadControlFailure,
  type ThreadControlOperation,
  ThreadReadResult,
} from "./schemas.ts";
import { boundThreadReadResult, makeThreadReadCallToolResult } from "./output.ts";
import { ThreadControlToolkit } from "./tools.ts";

const encodeThreadControlFailure = Schema.encodeUnknownSync(ThreadControlFailure);
const isThreadControlFailure = Schema.is(ThreadControlFailure);

const threadControlFailure = <E>(operation: ThreadControlOperation, cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const failures = cause.reasons.filter(Cause.isFailReason);
  const firstFailure = failures[0]?.error;
  const publicFailure =
    AiError.isAiError(firstFailure) && firstFailure.reason._tag === "ToolParameterValidationError"
      ? new ThreadControlError({
          code: "invalid_request",
          operation,
          message: `The request parameters for ${operation} are invalid.`,
          retryable: true,
        })
      : firstFailure;
  if (!isThreadControlFailure(publicFailure)) {
    return Effect.logWarning("thread-control MCP tool failed with an unexpected error", {
      failureCount: failures.length,
    }).pipe(
      Effect.as(
        new McpSchema.CallToolResult({
          isError: true,
          content: [
            {
              type: "text",
              text: "Thread-control tool execution failed due to an internal server error.",
            },
          ],
        }),
      ),
    );
  }
  const error = encodeThreadControlFailure(publicFailure);
  const result = new McpSchema.CallToolResult({
    isError: true,
    structuredContent: error,
    content: [{ type: "text", text: JSON.stringify(error) }],
  });
  return Effect.logWarning("thread-control MCP tool failed", {
    operation: error.operation,
    errorCode: error.code,
    environmentId: error.environmentId,
    callingThreadId: error.callingThreadId,
    targetThreadId: error.targetThreadId,
    targetProjectId: error.targetProjectId,
    providerInstanceId: error.providerInstanceId,
  }).pipe(Effect.as(result));
};

export const __testing = {
  threadControlFailure,
};

const registerThreadControlToolkit = Effect.fn("McpHttpServer.registerThreadControlToolkit")(
  function* () {
    const server = yield* McpServer.McpServer;
    const threadControl = yield* ThreadControlService.ThreadControlService;
    const built = yield* ThreadControlToolkit;
    for (const tool of Object.values(ThreadControlToolkit.tools)) {
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: tool.name,
          description: Tool.getDescription(tool),
          inputSchema: Tool.getJsonSchema(tool),
          annotations: {
            ...Context.getOption(tool.annotations, Tool.Title).pipe(
              Option.map((title) => ({ title })),
              Option.getOrUndefined,
            ),
            readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
            destructiveHint: Context.get(tool.annotations, Tool.Destructive),
            idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
            openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
          },
          _meta: Context.getOrUndefined(tool.annotations, Tool.Meta),
        }),
        annotations: tool.annotations,
        handle: (payload) =>
          Effect.withFiber((fiber) => {
            const invocation = Context.getUnsafe(
              fiber.context,
              McpInvocationContext.McpInvocationContext,
            );
            return built.handle(tool.name, payload).pipe(
              Stream.unwrap,
              Stream.run(Sink.last()),
              Effect.flatMap(Effect.fromOption),
              Effect.provideService(ThreadControlService.ThreadControlService, threadControl),
              Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
              Effect.matchCauseEffect({
                onFailure: (cause) => threadControlFailure(tool.name, cause),
                onSuccess: ({ encodedResult }) => {
                  if (tool.name === "thread_read") {
                    const bounded = boundThreadReadResult(
                      encodedResult as typeof ThreadReadResult.Type,
                    );
                    return Effect.succeed(makeThreadReadCallToolResult(bounded));
                  }
                  return Effect.succeed(
                    new McpSchema.CallToolResult({
                      isError: false,
                      structuredContent:
                        typeof encodedResult === "object" ? encodedResult : undefined,
                      content: [{ type: "text", text: JSON.stringify(encodedResult) }],
                    }),
                  );
                },
              }),
            );
          }),
      });
    }
  },
);

export const layer = Layer.effectDiscard(registerThreadControlToolkit()).pipe(
  Layer.provide(ThreadControlToolkitHandlersLive),
  Layer.provide(ThreadControlService.layer),
);
