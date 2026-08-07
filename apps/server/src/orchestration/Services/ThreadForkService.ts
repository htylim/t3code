import type { ThreadForkOperation } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ThreadForkError extends Schema.TaggedErrorClass<ThreadForkError>()("ThreadForkError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface ThreadForkServiceShape {
  readonly fork: (
    operation: ThreadForkOperation,
  ) => Effect.Effect<{ readonly sequence: number }, ThreadForkError>;
}

export class ThreadForkService extends Context.Reference<ThreadForkServiceShape>(
  "t3/orchestration/Services/ThreadForkService",
  {
    defaultValue: () => ({
      fork: () =>
        Effect.fail(
          new ThreadForkError({ message: "Thread forking is unavailable in this runtime." }),
        ),
    }),
  },
) {}
