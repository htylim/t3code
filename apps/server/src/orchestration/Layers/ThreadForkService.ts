// @effect-diagnostics nodeBuiltinImport:off
import {
  EventId,
  MessageId,
  ThreadId,
  type ChatAttachment,
  type OrchestrationThreadActivity,
  type ThreadCopyActivity,
  type ThreadCopyCreateCommand,
  type ThreadCopyMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "node:crypto";

import { createDeterministicAttachmentId, resolveAttachmentPath } from "../../attachmentStore.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import { hasOpenBlockingRequest } from "../decider.ts";
import { threadHasQueuedTurnStart } from "../ThreadSettlementPolicy.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadForkError,
  ThreadForkService,
  type ThreadForkServiceShape,
} from "../Services/ThreadForkService.ts";
import { withProjectMutationLock, withThreadMutationLock } from "../ThreadMutationLock.ts";

const isThreadForkError = Schema.is(ThreadForkError);

function copiedRecordId(kind: "message" | "activity", targetThreadId: ThreadId, sourceId: string) {
  const hex = NodeCrypto.createHash("sha256")
    .update(`${kind}\0${targetThreadId}\0${sourceId}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function copiedMessageId(targetThreadId: ThreadId, sourceMessageId: string): MessageId {
  return MessageId.make(copiedRecordId("message", targetThreadId, sourceMessageId));
}

export function copiedActivityId(targetThreadId: ThreadId, sourceActivityId: string): EventId {
  return EventId.make(copiedRecordId("activity", targetThreadId, sourceActivityId));
}

export function copiedAttachmentId(
  targetThreadId: ThreadId,
  sourceAttachmentId: string,
): string | null {
  return createDeterministicAttachmentId(targetThreadId, sourceAttachmentId);
}

function shouldCopyActivity(activity: OrchestrationThreadActivity): boolean {
  return !(
    activity.kind.startsWith("approval.") ||
    activity.kind.startsWith("provider.approval.") ||
    activity.kind.startsWith("user-input.") ||
    activity.kind.startsWith("provider.user-input.") ||
    activity.kind.startsWith("checkpoint.") ||
    activity.kind.startsWith("turn.plan.")
  );
}

function remapPayload(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
  key?: string,
): unknown {
  const normalizedKey = key?.toLowerCase();
  if (
    normalizedKey?.endsWith("turnid") ||
    normalizedKey?.endsWith("requestid") ||
    normalizedKey?.endsWith("checkpointref") ||
    normalizedKey?.endsWith("planid") ||
    normalizedKey === "sourceproposedplan"
  ) {
    return null;
  }
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => remapPayload(entry, replacements));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      remapPayload(entryValue, replacements, entryKey),
    ]),
  );
}

function failureMessage(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }
  return "Thread fork failed.";
}

const makeThreadForkService = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providers = yield* ProviderService.ProviderService;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const commandReceipts = yield* OrchestrationCommandReceiptRepository;

  const fork: ThreadForkServiceShape["fork"] = Effect.fn("ThreadForkService.fork")(
    function* (operation) {
      return yield* withProjectMutationLock(
        withThreadMutationLock(
          operation.sourceThreadId,
          Effect.gen(function* () {
            const receipt = yield* commandReceipts.getByCommandId({
              commandId: operation.commandId,
            });
            if (Option.isSome(receipt) && receipt.value.status === "accepted") {
              if (
                receipt.value.aggregateKind !== "thread" ||
                receipt.value.aggregateId !== operation.threadId
              ) {
                return yield* new ThreadForkError({
                  message: "The fork command id was already used by another operation.",
                });
              }
              return { sequence: receipt.value.resultSequence };
            }

            const getThreadForkSnapshot = snapshots.getThreadForkSnapshot;
            if (getThreadForkSnapshot === undefined) {
              return yield* new ThreadForkError({ message: "Thread forking is unavailable." });
            }
            const snapshotOption = yield* getThreadForkSnapshot(
              operation.sourceThreadId,
              operation.threadId,
            );
            if (Option.isNone(snapshotOption)) {
              return yield* new ThreadForkError({
                message: "The source thread is missing, archived, deleted, or not persisted.",
              });
            }
            const snapshot = snapshotOption.value;
            const source = snapshot.thread;
            if (snapshot.targetExists) {
              return yield* new ThreadForkError({ message: "The target thread already exists." });
            }
            if (source.session?.status === "starting" || source.session?.status === "running") {
              return yield* new ThreadForkError({
                message: "Wait for the source thread to finish before forking it.",
              });
            }
            if (source.latestTurn?.state === "running") {
              return yield* new ThreadForkError({
                message: "Wait for the source turn to finish before forking it.",
              });
            }
            const latestUserMessageAt =
              source.messages.findLast((message) => message.role === "user")?.createdAt ?? null;
            if (
              threadHasQueuedTurnStart(
                { latestUserMessageAt, latestTurn: source.latestTurn, session: source.session },
                operation.createdAt,
              )
            ) {
              return yield* new ThreadForkError({
                message: "Wait for the queued source turn to start before forking it.",
              });
            }
            if (snapshot.backgroundLiveness != null) {
              return yield* new ThreadForkError({
                message:
                  "Wait for the source thread's background work to finish before forking it.",
              });
            }
            if (
              snapshot.hasPendingApprovals ||
              snapshot.hasPendingUserInput ||
              hasOpenBlockingRequest(source)
            ) {
              return yield* new ThreadForkError({
                message: "Resolve the source thread's pending request before forking it.",
              });
            }

            const capabilities = yield* providers.getCapabilities(
              source.session?.providerInstanceId ?? source.modelSelection.instanceId,
            );
            if (capabilities.sessionFork !== "native") {
              return yield* new ThreadForkError({
                message: "This provider does not support thread forking.",
              });
            }

            const cwd = source.worktreePath ?? snapshot.workspaceRoot;
            const messageIdReplacements = new Map<string, string>();
            const attachmentIdReplacements = new Map<string, string>();
            const activityIdReplacements = new Map<string, string>();
            for (const message of source.messages) {
              messageIdReplacements.set(
                message.id,
                copiedMessageId(operation.threadId, message.id),
              );
              for (const attachment of message.attachments ?? []) {
                const targetAttachmentId = copiedAttachmentId(operation.threadId, attachment.id);
                if (targetAttachmentId === null) {
                  return yield* new ThreadForkError({
                    message: "The target thread id cannot own copied attachments.",
                  });
                }
                attachmentIdReplacements.set(attachment.id, targetAttachmentId);
              }
            }
            for (const activity of source.activities) {
              activityIdReplacements.set(
                activity.id,
                copiedActivityId(operation.threadId, activity.id),
              );
            }
            const replacements = new Map<string, string>([
              [operation.sourceThreadId, operation.threadId],
              ...messageIdReplacements,
              ...attachmentIdReplacements,
              ...activityIdReplacements,
            ]);

            const createdAttachmentPaths: string[] = [];
            const partialAttachmentPaths: string[] = [];
            const cleanupAttachments = Effect.suspend(() =>
              Effect.forEach(
                [...partialAttachmentPaths, ...createdAttachmentPaths],
                (attachmentPath) =>
                  fileSystem
                    .remove(attachmentPath, { force: true })
                    .pipe(Effect.catch(() => Effect.void)),
                { concurrency: 1, discard: true },
              ),
            );

            const copyAttachment = Effect.fn("ThreadForkService.copyAttachment")(function* (
              attachment: ChatAttachment,
            ) {
              const targetAttachmentId = attachmentIdReplacements.get(attachment.id);
              if (targetAttachmentId === undefined) {
                return yield* new ThreadForkError({
                  message: `Could not map copied attachment '${attachment.name}'.`,
                });
              }
              const targetAttachment = {
                ...attachment,
                id: targetAttachmentId,
              } satisfies ChatAttachment;
              const sourcePath = resolveAttachmentPath({
                attachmentsDir: config.attachmentsDir,
                attachment,
              });
              const targetPath = resolveAttachmentPath({
                attachmentsDir: config.attachmentsDir,
                attachment: targetAttachment,
              });
              if (sourcePath === null || targetPath === null) {
                return yield* new ThreadForkError({
                  message: `Could not resolve copied attachment '${attachment.name}'.`,
                });
              }
              const sourceBytes = yield* fileSystem.readFile(sourcePath);
              if (yield* fileSystem.exists(targetPath)) {
                const targetBytes = yield* fileSystem.readFile(targetPath);
                if (Buffer.from(sourceBytes).equals(Buffer.from(targetBytes)))
                  return targetAttachment;
                return yield* new ThreadForkError({
                  message: `A conflicting copied attachment already exists for '${attachment.name}'.`,
                });
              }
              yield* fileSystem.makeDirectory(path.dirname(targetPath), { recursive: true });
              const partialPath = `${targetPath}.partial`;
              partialAttachmentPaths.push(partialPath);
              yield* fileSystem.remove(partialPath, { force: true });
              yield* fileSystem.writeFile(partialPath, sourceBytes);
              yield* fileSystem.rename(partialPath, targetPath);
              partialAttachmentPaths.splice(partialAttachmentPaths.indexOf(partialPath), 1);
              createdAttachmentPaths.push(targetPath);
              return targetAttachment;
            });

            const materialize = Effect.gen(function* () {
              const messages: ThreadCopyMessage[] = [];
              for (const message of source.messages) {
                if (message.streaming) continue;
                const attachments = yield* Effect.forEach(
                  message.attachments ?? [],
                  copyAttachment,
                  {
                    concurrency: 1,
                  },
                );
                messages.push({
                  id: copiedMessageId(operation.threadId, message.id),
                  role: message.role,
                  text: message.text,
                  ...(attachments.length > 0 ? { attachments } : {}),
                  createdAt: message.createdAt,
                  updatedAt: message.updatedAt,
                });
              }

              const activities: ThreadCopyActivity[] = source.activities
                .filter(shouldCopyActivity)
                .map((activity) => ({
                  id: copiedActivityId(operation.threadId, activity.id),
                  tone: activity.tone,
                  kind: activity.kind,
                  summary: activity.summary,
                  payload: remapPayload(activity.payload, replacements),
                  createdAt: activity.createdAt,
                }));

              const providerSession = yield* providers.forkSession({
                sourceThreadId: operation.sourceThreadId,
                targetThreadId: operation.threadId,
                cwd,
              });
              if (providerSession.providerInstanceId === undefined) {
                return yield* new ThreadForkError({
                  message: "The forked provider session has no durable provider binding.",
                });
              }

              const baselineRef = checkpointRefForThreadTurn(operation.threadId, 0);
              if (yield* checkpoints.isGitRepository(cwd)) {
                const baselineExists = yield* checkpoints.hasCheckpointRef({
                  cwd,
                  checkpointRef: baselineRef,
                });
                if (!baselineExists) {
                  yield* checkpoints.captureCheckpoint({ cwd, checkpointRef: baselineRef });
                }
              }

              const command: ThreadCopyCreateCommand = {
                type: "thread.copy.create",
                commandId: operation.commandId,
                threadId: operation.threadId,
                projectId: source.projectId,
                title: `${source.title} (fork)`,
                modelSelection: source.modelSelection,
                runtimeMode: source.runtimeMode,
                interactionMode: source.interactionMode,
                branch: source.branch,
                worktreePath: source.worktreePath,
                messages,
                activities,
                session: {
                  threadId: operation.threadId,
                  status: "ready",
                  providerName: providerSession.provider,
                  providerInstanceId: providerSession.providerInstanceId,
                  runtimeMode: providerSession.runtimeMode,
                  activeTurnId: null,
                  lastError: null,
                  updatedAt: providerSession.updatedAt,
                },
                createdAt: operation.createdAt,
              };
              return yield* engine.dispatch(command);
            });

            return yield* materialize.pipe(
              Effect.catch((cause) =>
                cleanupAttachments.pipe(
                  Effect.andThen(
                    Effect.fail(
                      isThreadForkError(cause)
                        ? cause
                        : new ThreadForkError({ message: failureMessage(cause), cause }),
                    ),
                  ),
                ),
              ),
            );
          }).pipe(
            Effect.mapError((cause) =>
              isThreadForkError(cause)
                ? cause
                : new ThreadForkError({ message: failureMessage(cause), cause }),
            ),
          ),
        ),
      );
    },
  );

  return ThreadForkService.of({ fork });
});

export const ThreadForkServiceLive = Layer.effect(ThreadForkService, makeThreadForkService);
