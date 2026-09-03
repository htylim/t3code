import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  copiedActivityId,
  copiedAttachmentId,
  copiedMessageId,
  ThreadForkServiceLive,
} from "./ThreadForkService.ts";
import { ThreadForkService } from "../Services/ThreadForkService.ts";
import { ThreadForkError } from "../Services/ThreadForkService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { ServerConfig } from "../../config.ts";
import { withThreadMutationLock } from "../ThreadMutationLock.ts";

const createdAt = "2026-08-06T12:00:00.000Z";
const historicalAt = "2026-08-01T12:00:00.000Z";
const sourceThreadId = ThreadId.make("thread-source");
const targetThreadId = ThreadId.make("thread-target");

function sourceThread(overrides?: Partial<OrchestrationThread>): OrchestrationThread {
  return {
    id: sourceThreadId,
    projectId: ProjectId.make("project-1"),
    title: "Source",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature/fork",
    worktreePath: "/tmp/fork-worktree",
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    deletedAt: null,
    messages: [
      {
        id: copiedMessageId(sourceThreadId, "original"),
        role: "user",
        text: "hello",
        turnId: null,
        streaming: false,
        createdAt: historicalAt,
        updatedAt: historicalAt,
      },
    ],
    proposedPlans: [],
    activities: [
      {
        id: copiedActivityId(sourceThreadId, "original"),
        tone: "info",
        kind: "tool.completed",
        summary: "Done",
        payload: { threadId: sourceThreadId, turnId: "turn-source" },
        turnId: null,
        createdAt,
      },
    ],
    checkpoints: [],
    session: {
      threadId: sourceThreadId,
      status: "ready",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: createdAt,
    },
    ...overrides,
  };
}

function makeHarness(input?: {
  readonly thread?: OrchestrationThread;
  readonly targetExists?: boolean;
  readonly acceptedSequence?: number;
  readonly providerFailure?: boolean;
  readonly gitRepository?: boolean;
  readonly backgroundLiveness?: "working" | "monitoring" | null;
}) {
  const dispatched: OrchestrationCommand[] = [];
  const capturedCheckpoints: Array<{ readonly cwd: string; readonly checkpointRef: string }> = [];
  const forkSession = vi.fn(() =>
    input?.providerFailure
      ? Effect.fail(new ThreadForkError({ message: "native fork failed" }))
      : Effect.succeed({
          provider: "codex" as const,
          providerInstanceId: ProviderInstanceId.make("codex"),
          status: "ready" as const,
          runtimeMode: "full-access" as const,
          cwd: "/tmp/fork-worktree",
          threadId: targetThreadId,
          resumeCursor: { threadId: "native-target" },
          createdAt,
          updatedAt: createdAt,
        }),
  );
  const engine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: 42 };
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    subscribeDomainEvents: Effect.succeed(Stream.empty),
    latestSequence: Effect.succeed(0),
  } satisfies OrchestrationEngineService["Service"];
  const projection = {
    getThreadForkSnapshot: () =>
      Effect.succeed(
        Option.some({
          thread: input?.thread ?? sourceThread(),
          workspaceRoot: "/tmp/project",
          targetExists: input?.targetExists ?? false,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          backgroundLiveness: input?.backgroundLiveness ?? null,
        }),
      ),
  } as unknown as ProjectionSnapshotQuery["Service"];
  const provider = {
    getCapabilities: () =>
      Effect.succeed({ sessionModelSwitch: "in-session" as const, sessionFork: "native" as const }),
    forkSession,
  } as unknown as ProviderService.ProviderService["Service"];
  const checkpointStore = {
    isGitRepository: () => Effect.succeed(input?.gitRepository ?? false),
    hasCheckpointRef: () => Effect.succeed(false),
    captureCheckpoint: (checkpoint: { readonly cwd: string; readonly checkpointRef: string }) =>
      Effect.sync(() => {
        capturedCheckpoints.push(checkpoint);
      }),
    restoreCheckpoint: () => Effect.succeed(false),
    diffCheckpoints: () => Effect.succeed(""),
    deleteCheckpointRefs: () => Effect.void,
  } satisfies CheckpointStore.CheckpointStore["Service"];
  const receipts = {
    getByCommandId: () =>
      Effect.succeed(
        input?.acceptedSequence === undefined
          ? Option.none()
          : Option.some({
              commandId: CommandId.make("command-fork"),
              aggregateKind: "thread" as const,
              aggregateId: targetThreadId,
              acceptedAt: createdAt,
              resultSequence: input.acceptedSequence,
              status: "accepted" as const,
              error: null,
            }),
      ),
    upsert: () => Effect.void,
  } satisfies OrchestrationCommandReceiptRepository["Service"];
  const layer = ThreadForkServiceLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provide(Layer.succeed(ProjectionSnapshotQuery, projection)),
    Layer.provide(Layer.succeed(ProviderService.ProviderService, provider)),
    Layer.provide(Layer.succeed(CheckpointStore.CheckpointStore, checkpointStore)),
    Layer.provide(Layer.succeed(OrchestrationCommandReceiptRepository, receipts)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "thread-fork-test-" })),
    Layer.provide(NodeServices.layer),
  );
  const operation = {
    type: "thread.fork" as const,
    commandId: CommandId.make("command-fork"),
    sourceThreadId,
    threadId: targetThreadId,
    createdAt,
  };
  return {
    dispatched,
    capturedCheckpoints,
    forkSession,
    run: () =>
      Effect.runPromise(
        ThreadForkService.pipe(
          Effect.flatMap((service) => service.fork(operation)),
          Effect.provide(layer),
        ),
      ),
  };
}

it("copy events preserve completed messages with deterministic target ids", () => {
  const target = ThreadId.make("thread-target");
  expect(copiedMessageId(target, "message-source")).toBe(copiedMessageId(target, "message-source"));
  expect(copiedMessageId(target, "message-source")).not.toBe("message-source");
  expect(copiedMessageId(target, "message-source")).not.toContain("fork");
});

it("copy events preserve historical activities with deterministic target ids", () => {
  const target = ThreadId.make("thread-target");
  expect(copiedActivityId(target, "activity-source")).toBe(
    copiedActivityId(target, "activity-source"),
  );
  expect(copiedActivityId(target, "activity-source")).not.toBe("activity-source");
  expect(copiedActivityId(target, "activity-source")).not.toContain("fork");
});

it("copy events use deterministic target-owned attachment ids", () => {
  const target = ThreadId.make("thread-target");
  const first = copiedAttachmentId(target, "attachment-source");
  expect(first).not.toBeNull();
  if (first === null) throw new Error("expected copied attachment id");
  expect(first).toBe(copiedAttachmentId(target, "attachment-source"));
  expect(first).not.toBe("attachment-source");
  expect(first.startsWith("thread-target-")).toBe(true);
});

it("fork operation performs the native fork before publishing the target", async () => {
  const harness = makeHarness();
  const result = await harness.run();

  expect(result).toEqual({ sequence: 42 });
  expect(harness.forkSession).toHaveBeenCalledOnce();
  expect(harness.dispatched).toHaveLength(1);
  const command = harness.dispatched[0];
  expect(command?.type).toBe("thread.copy.create");
  if (command?.type !== "thread.copy.create") throw new Error("expected copy command");
  expect(command.title).toBe("Source (fork)");
  expect(command.worktreePath).toBe("/tmp/fork-worktree");
  expect(command.session.threadId).toBe(targetThreadId);
  expect(command.messages[0]?.id).not.toBe(sourceThread().messages[0]?.id);
  expect(command.activities[0]?.payload).toEqual({ threadId: targetThreadId, turnId: null });
});

it("fork baseline uses a target-namespaced ref and the shared source cwd", async () => {
  const harness = makeHarness({ gitRepository: true });
  await harness.run();

  expect(harness.forkSession).toHaveBeenCalledWith({
    sourceThreadId,
    targetThreadId,
    cwd: "/tmp/fork-worktree",
  });
  expect(harness.capturedCheckpoints).toEqual([
    {
      cwd: "/tmp/fork-worktree",
      checkpointRef: "refs/t3/checkpoints/dGhyZWFkLXRhcmdldA/turn/0",
    },
  ]);
});

it("fork operation rejects starting running and queued-turn sources", async () => {
  const harness = makeHarness({
    thread: sourceThread({
      session: { ...sourceThread().session!, status: "running" },
    }),
  });
  await expect(harness.run()).rejects.toThrow("finish before forking");
  expect(harness.forkSession).not.toHaveBeenCalled();
  expect(harness.dispatched).toHaveLength(0);
});

it("fork operation rejects sources with background work", async () => {
  const harness = makeHarness({ backgroundLiveness: "monitoring" });
  await expect(harness.run()).rejects.toThrow("background work to finish before forking");
  expect(harness.forkSession).not.toHaveBeenCalled();
  expect(harness.dispatched).toHaveLength(0);
});

it("fork operation publishes no target when the native fork or baseline fails", async () => {
  const harness = makeHarness({ providerFailure: true });
  await expect(harness.run()).rejects.toThrow("native fork failed");
  expect(harness.dispatched).toHaveLength(0);
});

it("lost success response retries through the existing command receipt without duplicating work", async () => {
  const harness = makeHarness({ acceptedSequence: 77, targetExists: true });
  await expect(harness.run()).resolves.toEqual({ sequence: 77 });
  expect(harness.forkSession).not.toHaveBeenCalled();
  expect(harness.dispatched).toHaveLength(0);
});

it("fork operation serializes against mutations on the same source", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        withThreadMutationLock(
          sourceThreadId,
          Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
          ),
        ),
        { startImmediately: true },
      );
      yield* Deferred.await(firstEntered);
      const second = yield* Effect.forkChild(
        withThreadMutationLock(sourceThreadId, Deferred.succeed(secondEntered, undefined)),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(secondEntered)).toBe(false);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(yield* Deferred.isDone(secondEntered)).toBe(true);
    }),
  );
});
