import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

export const TransientSideChatCleanupInput = Schema.Struct({ threadId: ThreadId });
export const TransientSideChatCleanupResult = Schema.Struct({
  providerHistory: Schema.Literals(["deleted", "already-absent", "not-started", "unsupported"]),
});

export class TransientSideChatCleanupError extends Schema.TaggedError<TransientSideChatCleanupError>()(
  "TransientSideChatCleanupError",
  {
    message: Schema.String,
    reason: Schema.Literals(["invalid-target", "unsafe-session", "provider-error", "busy"]),
  },
) {}
