import * as Schema from "effect/Schema";
import {
  TransientChatProviderThreadDeleteError,
  type TransientChatProvider,
} from "@t3tools/provider-core/server/errors";

/** Preserves an existing deletion error or wraps a provider failure. */
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
