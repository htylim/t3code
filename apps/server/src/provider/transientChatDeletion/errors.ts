import * as Schema from "effect/Schema";

export const TransientChatProvider = Schema.Literals(["codex", "claudeAgent", "opencode"]);
export type TransientChatProvider = typeof TransientChatProvider.Type;

export class TransientChatProviderThreadDeleteError extends Schema.TaggedError<TransientChatProviderThreadDeleteError>()(
  "TransientChatProviderThreadDeleteError",
  {
    provider: TransientChatProvider,
    providerSessionId: Schema.String,
    reason: Schema.Literals(["invalid-target", "unsafe-session", "provider-error"]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const isDeletionError = Schema.is(TransientChatProviderThreadDeleteError);

export function deletionError(
  provider: TransientChatProvider,
  providerSessionId: string,
  cause: unknown,
): TransientChatProviderThreadDeleteError {
  if (isDeletionError(cause)) return cause;
  return new TransientChatProviderThreadDeleteError({
    provider,
    providerSessionId,
    reason: "provider-error",
    message: cause instanceof Error ? cause.message : "Provider session deletion failed.",
    cause,
  });
}
