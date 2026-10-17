import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export class ProviderDriverError extends Schema.TaggedError<ProviderDriverError>()(
  "ProviderDriverError",
  {
    driver: ProviderDriverKind,
    instanceId: ProviderInstanceId,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Provider driver '${this.driver}' failed to create instance '${this.instanceId}': ${this.detail}`;
  }
}

export class ProviderCredentialError extends Schema.TaggedError<ProviderCredentialError>()(
  "ProviderCredentialError",
  {
    operation: Schema.Literals(["get", "set", "remove"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not ${this.operation} stored provider credentials.`;
  }
}

/** Native providers supported by transient history deletion. */
export const TransientChatProvider = Schema.Literals(["codex", "claudeAgent", "opencode"]);
export type TransientChatProvider = typeof TransientChatProvider.Type;

/** Native history deletion failed or refused an unsafe target. */
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
