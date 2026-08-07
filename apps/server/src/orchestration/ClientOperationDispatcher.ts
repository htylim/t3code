import type { OrchestrationCommand, ThreadForkOperation } from "@t3tools/contracts";
import { OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ThreadForkService } from "./Services/ThreadForkService.ts";

type DispatchCommand = (
  command: OrchestrationCommand,
) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;

const sanitizeDispatchFailure = (cause: unknown) =>
  new OrchestrationDispatchCommandError({
    message:
      typeof cause === "object" &&
      cause !== null &&
      "message" in cause &&
      typeof cause.message === "string"
        ? cause.message
        : "Failed to dispatch orchestration operation",
  });

export function dispatchClientOperation(
  operation: OrchestrationCommand | ThreadForkOperation,
  options?: { readonly dispatchCommand?: DispatchCommand },
): Effect.Effect<
  { readonly sequence: number },
  OrchestrationDispatchCommandError,
  OrchestrationEngineService
> {
  if (operation.type === "thread.fork") {
    return ThreadForkService.pipe(
      Effect.flatMap((service) => service.fork(operation)),
      Effect.mapError(sanitizeDispatchFailure),
    );
  }

  if (options?.dispatchCommand) {
    return options.dispatchCommand(operation);
  }

  return OrchestrationEngineService.pipe(
    Effect.flatMap((engine) => engine.dispatch(operation)),
    Effect.mapError(sanitizeDispatchFailure),
  );
}
