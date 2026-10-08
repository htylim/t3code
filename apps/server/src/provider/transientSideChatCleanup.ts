import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";

import {
  ClaudeSettings,
  CodexSettings,
  OpenCodeSettings,
  CommandId,
  ProviderInstanceId,
  TransientSideChatCleanupError,
  type TransientSideChatCleanupInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import { ProviderSessionRuntimeRepository } from "../persistence/ProviderSessionRuntime.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { transientChatCleanupGate } from "./transientChatDeletion/lifecycle.ts";
import { TransientChatProviderThreadDeleteError } from "./transientChatDeletion/errors.ts";
import { deleteTransientChatProviderThread } from "./transientChatProviderThreadDelete.ts";

const CleanupTarget = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: Schema.String,
  nativeId: Schema.String,
  cwd: Schema.String,
  configFingerprint: Schema.String,
});
const CleanupState = Schema.Struct({
  transientSideChatCleanup: Schema.Literals(["pending", "complete"]),
  targets: Schema.Array(CleanupTarget),
});
const decodeCleanupState = Schema.decodeUnknownOption(CleanupState);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCodex = Schema.decodeUnknownEffect(CodexSettings);
const decodeClaude = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeOpenCode = Schema.decodeUnknownEffect(OpenCodeSettings);

/** Reject a cleanup target without changing provider history. */
function invalidTarget(message: string) {
  return new TransientSideChatCleanupError({ reason: "invalid-target", message });
}

/** Keep matching native IDs in separate provider homes independent. */
function cleanupTargetKey(instanceId: ProviderInstanceId, nativeId: string): string {
  return JSON.stringify([instanceId, nativeId]);
}

/** Stop native work and delete only the histories captured for this transient thread. */
export const makeTransientSideChatCleanup = Effect.fn("makeTransientSideChatCleanup")(function* (
  deleteProviderThread: typeof deleteTransientChatProviderThread = deleteTransientChatProviderThread,
) {
  const threads = yield* ThreadManagementService;
  const providers = yield* ProviderSessionManagerV2;
  const runtimes = yield* ProviderSessionRuntimeRepository;
  const projects = yield* ProjectService;
  const settings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  /** Fingerprint settings so a retry cannot delete from a different provider account or home. */
  const fingerprint = Effect.fn("TransientSideChatCleanup.fingerprint")(function* (
    instance: unknown,
  ) {
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(encodeJson(instance)))
      .pipe(Effect.orDie);
    return Hex.encode(digest);
  });

  const providerContext =
    yield* Effect.context<Effect.Services<ReturnType<typeof deleteTransientChatProviderThread>>>();

  return Effect.fn("cleanupTransientSideChat")(
    function* ({ threadId }: typeof TransientSideChatCleanupInput.Type) {
      return yield* transientChatCleanupGate.cleanup(
        threadId,
        Effect.gen(function* () {
          const projection = yield* threads.getThreadProjection(threadId);
          const storedRuntime = Option.getOrUndefined(yield* runtimes.getByThreadId({ threadId }));
          const prior = Option.getOrUndefined(decodeCleanupState(storedRuntime?.runtimePayload));
          if (
            prior?.transientSideChatCleanup === "complete" &&
            projection.thread.deletedAt !== null
          ) {
            return { providerHistory: "already-absent" as const };
          }
          const instances = deriveProviderInstanceConfigMap(yield* settings.getSettings);
          const project = Option.getOrUndefined(
            yield* projects.getById(projection.thread.projectId, { includeDeleted: true }),
          );
          if (!project) return yield* invalidTarget("The transient chat project was not found.");
          const targets = [...(prior?.targets ?? [])];
          if (prior === undefined) {
            for (const providerThread of projection.providerThreads) {
              const nativeId = providerThread.nativeThreadRef?.nativeId;
              if (nativeId == null) continue;
              const instance = instances[providerThread.providerInstanceId];
              const session = projection.providerSessions.find(
                (candidate) => candidate.id === providerThread.providerSessionId,
              );
              targets.push({
                instanceId: providerThread.providerInstanceId,
                driver: providerThread.driver,
                nativeId,
                cwd: session?.cwd ?? projection.thread.worktreePath ?? project.workspaceRoot,
                configFingerprint: yield* fingerprint(instance ?? null),
              });
            }
          }
          for (const target of targets) {
            const instance = instances[target.instanceId];
            if (
              !instance ||
              instance.driver !== target.driver ||
              (yield* fingerprint(instance)) !== target.configFingerprint
            ) {
              return yield* invalidTarget(
                "The original provider configuration is unavailable or changed. Restore it before retrying cleanup.",
              );
            }
          }
          // The existing runtime repository retains feature-owned retry state. V2's
          // deleted thread prevents admission after a restart; no V1 services are used.
          const marker = {
            threadId,
            providerName: targets[0]?.driver ?? "none",
            providerInstanceId:
              targets[0]?.instanceId ?? projection.thread.modelSelection.instanceId,
            adapterKey: "transient-side-chat-cleanup",
            runtimeMode: projection.thread.runtimeMode,
            status: "stopped" as const,
            lastSeenAt: DateTime.formatIso(yield* DateTime.now),
            resumeCursor: null,
            runtimePayload: { transientSideChatCleanup: "pending", targets },
          };
          yield* runtimes.upsert(marker);
          // Stop native work before thread.delete schedules its best-effort detach.
          // Otherwise that detach can remove the runtime before cleanup awaits unload.
          // Shared Codex runtimes remain available to their other threads.
          const deletedByRuntime = new Map<string, "deleted" | "already-absent">();
          for (const session of projection.providerSessions) {
            const runtime = Option.getOrUndefined(yield* providers.get(session.id));
            if (runtime) {
              const providerThreads = projection.providerThreads.filter(
                (thread) => thread.providerSessionId === session.id,
              );
              for (const providerThread of providerThreads) {
                for (const turn of projection.providerTurns) {
                  if (turn.providerThreadId === providerThread.id && turn.status === "running") {
                    yield* runtime.interruptTurn({ providerThread, providerTurnId: turn.id });
                  }
                }
                if (
                  runtime.deleteTransientThreadHistory &&
                  providerThread.nativeThreadRef?.nativeId != null
                ) {
                  const outcome = yield* runtime.deleteTransientThreadHistory({ providerThread });
                  deletedByRuntime.set(
                    cleanupTargetKey(
                      providerThread.providerInstanceId,
                      providerThread.nativeThreadRef.nativeId,
                    ),
                    outcome,
                  );
                } else if (runtime.unloadThread) {
                  yield* runtime.unloadThread({ providerThread });
                }
              }
              if (!runtime.unloadThread) yield* providers.close(session.id);
            }
            yield* providers.detach({
              providerSessionId: session.id,
              threadId,
              revokeMcpCredential: true,
            });
          }
          if (projection.thread.deletedAt === null) {
            yield* threads.dispatch({
              type: "thread.delete",
              threadId,
              commandId: CommandId.make(`transient-side-chat-cleanup:${threadId}`),
            });
          }
          let providerHistory: "deleted" | "already-absent" | "not-started" | "unsupported" =
            "not-started";
          for (const target of targets) {
            const instance = instances[target.instanceId]!;
            const common = {
              cwd: target.cwd,
              providerSessionId: target.nativeId,
              environment: mergeProviderInstanceEnvironment(instance.environment),
              allowMissing: true,
            };
            let deleted: "deleted" | "already-absent" | "unsupported";
            const runtimeOutcome = deletedByRuntime.get(
              cleanupTargetKey(target.instanceId, target.nativeId),
            );
            if (runtimeOutcome !== undefined) {
              deleted = runtimeOutcome;
            } else {
              switch (target.driver) {
                case "codex":
                  deleted = yield* deleteProviderThread({
                    ...common,
                    provider: "codex",
                    config: yield* decodeCodex(instance.config ?? {}),
                  }).pipe(Effect.provide(providerContext));
                  break;
                case "claudeAgent":
                  deleted = yield* deleteProviderThread({
                    ...common,
                    provider: "claudeAgent",
                    config: yield* decodeClaude(instance.config ?? {}),
                  }).pipe(Effect.provide(providerContext));
                  break;
                case "opencode":
                  deleted = yield* deleteProviderThread({
                    ...common,
                    provider: "opencode",
                    config: yield* decodeOpenCode(instance.config ?? {}),
                  }).pipe(Effect.provide(providerContext));
                  break;
                default:
                  deleted = "unsupported";
              }
            }
            if (
              deleted === "unsupported" ||
              providerHistory === "not-started" ||
              deleted === "deleted"
            )
              providerHistory = deleted;
          }
          yield* runtimes.upsert({
            ...marker,
            runtimePayload: { transientSideChatCleanup: "complete", targets },
          });
          return { providerHistory };
        }),
      );
    },
    Effect.timeout("60 seconds"),
    Effect.mapError((cause) => {
      if (Schema.is(TransientSideChatCleanupError)(cause)) return cause;
      if (Schema.is(TransientChatProviderThreadDeleteError)(cause))
        return new TransientSideChatCleanupError({ reason: cause.reason, message: cause.message });
      return new TransientSideChatCleanupError({
        reason: "provider-error",
        message: cause instanceof Error ? cause.message : "Transient side-chat cleanup failed.",
      });
    }),
  );
});
