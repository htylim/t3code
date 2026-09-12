import * as NodeCrypto from "node:crypto";

import {
  ClaudeSettings,
  CodexSettings,
  OpenCodeSettings,
  CommandId,
  TransientSideChatCleanupError,
  type TransientSideChatCleanupInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ThreadDeletionReactor } from "../orchestration/Services/ThreadDeletionReactor.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderValidationError } from "./Errors.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { ProviderService } from "./Services/ProviderService.ts";
import { ProviderSessionDirectory } from "./Services/ProviderSessionDirectory.ts";
import { TransientChatCleanupGate } from "./transientChatDeletion/lifecycle.ts";
import { TransientChatProviderThreadDeleteError } from "./transientChatDeletion/errors.ts";
import { deleteTransientChatProviderThread } from "./transientChatProviderThreadDelete.ts";

const decodeCodex = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaude = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeOpenCode = Schema.decodeUnknownEffect(OpenCodeSettings);
const decodeCodexCursor = Schema.decodeUnknownEffect(Schema.Struct({ threadId: Schema.String }));
const decodeClaudeCursor = Schema.decodeUnknownEffect(Schema.Struct({ resume: Schema.String }));
const decodeOpenCodeCursor = Schema.decodeUnknownEffect(
  Schema.Struct({ sessionId: Schema.String }),
);
const decodeRuntime = Schema.decodeUnknownEffect(Schema.Struct({ cwd: Schema.String }));
const decodeCleanupState = Schema.decodeUnknownOption(
  Schema.Struct({
    transientSideChatCleanup: Schema.Literals(["pending", "complete"]),
    transientSideChatCleanupConfig: Schema.optionalKey(Schema.String),
    transientSideChatCleanupNoSession: Schema.optionalKey(Schema.Boolean),
  }),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isCleanupError = Schema.is(TransientSideChatCleanupError);
const isProviderDeleteError = Schema.is(TransientChatProviderThreadDeleteError);
const isValidationError = Schema.is(ProviderValidationError);

const invalid = (message: string) =>
  new TransientSideChatCleanupError({ reason: "invalid-target", message });

/** Only the transient cleanup RPC calls this; ordinary thread.delete keeps its existing behavior. */
export const makeTransientSideChatCleanup = Effect.fn("makeTransientSideChatCleanup")(function* (
  deleteProviderThread: typeof deleteTransientChatProviderThread = deleteTransientChatProviderThread,
) {
  const engine = yield* OrchestrationEngineService;
  const deletionReactor = yield* ThreadDeletionReactor;
  const threads = yield* ProjectionThreadRepository;
  const directory = yield* ProviderSessionDirectory;
  const settings = yield* ServerSettingsService;
  const providers = yield* ProviderService;
  const gate = yield* TransientChatCleanupGate;
  const providerContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof deleteTransientChatProviderThread>>>();
  const deleteNative = (input: Parameters<typeof deleteTransientChatProviderThread>[0]) =>
    deleteProviderThread(input).pipe(Effect.provide(providerContext));

  return Effect.fn("cleanupTransientSideChat")(
    function* ({ threadId }: typeof TransientSideChatCleanupInput.Type) {
      return yield* gate.cleanup(
        threadId,
        Effect.gen(function* () {
          const thread = Option.getOrUndefined(yield* threads.getById({ threadId }));
          if (!thread) return yield* invalid("The transient T3 thread was not found.");
          const binding = Option.getOrUndefined(yield* directory.getBinding(threadId));
          const prior = Option.getOrUndefined(decodeCleanupState(binding?.runtimePayload));
          if (prior?.transientSideChatCleanup === "complete" && thread.deletedAt !== null) {
            return { providerHistory: "already-absent" as const };
          }
          const instanceId = binding?.providerInstanceId ?? thread.modelSelection.instanceId;
          const instance = (yield* settings.getSettings).providerInstances[instanceId];
          if (!instance || (binding && instance.driver !== binding.provider)) {
            return yield* invalid(
              "The original provider instance is unavailable or has changed driver.",
            );
          }
          const configFingerprint = NodeCrypto.createHash("sha256")
            .update(encodeJson(instance))
            .digest("hex");
          if (
            prior?.transientSideChatCleanupConfig &&
            prior.transientSideChatCleanupConfig !== configFingerprint
          ) {
            return yield* invalid(
              "The provider configuration changed during cleanup. Restore it before retrying.",
            );
          }
          // The marker also covers never-started chats. A late admission must not
          // recreate a provider session after this request returns or the server restarts.
          yield* directory.upsert({
            threadId,
            provider: instance.driver,
            providerInstanceId: instanceId,
            ...(binding ? {} : { status: "stopped", runtimeMode: thread.runtimeMode }),
            runtimePayload: {
              transientSideChatCleanup: "pending",
              transientSideChatCleanupConfig: configFingerprint,
              ...(!binding ? { transientSideChatCleanupNoSession: true } : {}),
            },
          });
          if (thread.deletedAt === null) {
            yield* engine.dispatch({
              type: "thread.delete",
              threadId,
              commandId: CommandId.make(`transient-side-chat-cleanup:${threadId}`),
            });
          }

          yield* deletionReactor.drainThrough(yield* engine.latestSequence);

          let providerHistory: "deleted" | "already-absent" | "not-started" | "unsupported" =
            "not-started";
          // The ordinary deletion reactor is best-effort. Await a stop whose
          // failure propagates before touching provider history.
          if (binding && !prior?.transientSideChatCleanupNoSession) {
            yield* providers.stopSession({ threadId });
            const stopped = Option.getOrUndefined(yield* directory.getBinding(threadId));
            if (!stopped)
              return yield* invalid("The provider session binding disappeared during cleanup.");
            if (!["codex", "claudeAgent", "opencode"].includes(instance.driver)) {
              providerHistory = "unsupported";
            } else {
              const { cwd } = yield* decodeRuntime(stopped.runtimePayload);
              const common = {
                cwd,
                environment: mergeProviderInstanceEnvironment(instance.environment),
                allowMissing: true,
              };
              switch (instance.driver) {
                case "codex":
                  providerHistory = yield* deleteNative({
                    ...common,
                    provider: "codex",
                    providerSessionId: (yield* decodeCodexCursor(stopped.resumeCursor)).threadId,
                    config: yield* decodeCodex(instance.config ?? {}),
                  });
                  break;
                case "claudeAgent":
                  providerHistory = yield* deleteNative({
                    ...common,
                    provider: "claudeAgent",
                    providerSessionId: (yield* decodeClaudeCursor(stopped.resumeCursor)).resume,
                    config: yield* decodeClaude(instance.config ?? {}),
                  });
                  break;
                case "opencode":
                  providerHistory = yield* deleteNative({
                    ...common,
                    provider: "opencode",
                    providerSessionId: (yield* decodeOpenCodeCursor(stopped.resumeCursor))
                      .sessionId,
                    config: yield* decodeOpenCode(instance.config ?? {}),
                  });
                  break;
                default:
                  providerHistory = "unsupported";
              }
            }
          }
          yield* directory.upsert({
            threadId,
            provider: instance.driver,
            providerInstanceId: instanceId,
            runtimePayload: { transientSideChatCleanup: "complete" },
          });
          return { providerHistory };
        }),
      );
    },
    Effect.timeout("60 seconds"),
    Effect.mapError((cause) => {
      if (isCleanupError(cause)) return cause;
      if (isProviderDeleteError(cause)) {
        return new TransientSideChatCleanupError({ reason: cause.reason, message: cause.message });
      }
      return new TransientSideChatCleanupError({
        reason: isValidationError(cause) ? "busy" : "provider-error",
        message: isValidationError(cause)
          ? cause.issue
          : cause instanceof Error && cause.message
            ? cause.message
            : "Transient side-chat cleanup failed.",
      });
    }),
  );
});
