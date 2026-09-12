import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId, ProviderDriverKind } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ThreadDeletionReactor } from "../orchestration/Services/ThreadDeletionReactor.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../persistence/Services/ProjectionThreads.ts";
import * as ServerSettings from "../serverSettings.ts";
import { ProviderValidationError } from "./Errors.ts";
import { OpenCodeRuntimeLive } from "./opencodeRuntime.ts";
import { ProviderService } from "./Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "./Services/ProviderSessionDirectory.ts";
import { TransientChatProviderThreadDeleteError } from "./transientChatDeletion/errors.ts";
import {
  makeTransientChatCleanupGate,
  TransientChatCleanupGate,
} from "./transientChatDeletion/lifecycle.ts";
import { makeTransientSideChatCleanup } from "./transientSideChatCleanup.ts";
import type { TransientChatProviderThreadDeleteInput } from "./transientChatProviderThreadDelete.ts";

const threadId = ThreadId.make("side-chat");
const nativeId = "11111111-1111-4111-8111-111111111111";
const instanceId = ProviderInstanceId.make("test-instance");
const runtime = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));

const fixture = Effect.fn("fixture")(function* (driver = "codex", started = true) {
  const gate = yield* makeTransientChatCleanupGate;
  const provider = ProviderDriverKind.make(driver);
  let thread: ProjectionThread = {
    threadId,
    projectId: ProjectId.make("project"),
    title: "Side chat",
    modelSelection: { instanceId, model: "test" },
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurnId: null,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    latestUserMessageAt: null,
    pendingApprovalCount: 0,
    pendingUserInputCount: 0,
    hasActionableProposedPlan: 0,
    deletedAt: null,
  };
  const cursor =
    provider === "codex"
      ? { threadId: nativeId }
      : provider === "claudeAgent"
        ? { resume: nativeId }
        : { sessionId: "ses_native" };
  let binding: ProviderRuntimeBinding | undefined = started
    ? {
        threadId,
        provider,
        providerInstanceId: instanceId,
        status: "running",
        resumeCursor: cursor,
        runtimePayload: { cwd: "/project" },
      }
    : undefined;
  const calls: string[] = [];
  const nativeCalls: TransientChatProviderThreadDeleteInput[] = [];
  let stopFails = false;
  let nativeFails = false;
  let nativeGone = false;
  const directory = {
    getBinding: () => Effect.sync(() => Option.fromUndefinedOr(binding)),
    upsert: (next: ProviderRuntimeBinding) =>
      Effect.sync(() => {
        binding = {
          ...binding,
          ...next,
          runtimePayload: {
            ...(binding?.runtimePayload as object),
            ...(next.runtimePayload as object),
          },
        };
      }),
  };
  const providers = {
    stopSession: () =>
      Effect.gen(function* () {
        calls.push("stop");
        if (stopFails)
          return yield* new ProviderValidationError({ operation: "stop", issue: "Stop failed" });
        if (binding) binding = { ...binding, status: "stopped" };
      }),
  };
  const engine = {
    latestSequence: Effect.succeed(1),
    dispatch: () =>
      Effect.sync(() => {
        calls.push("t3-delete");
        thread = { ...thread, deletedAt: "2026-09-12T00:01:00.000Z" };
        return { sequence: 1 };
      }),
  };
  const repository = { getById: () => Effect.sync(() => Option.some(thread)) };
  const settingsLayer = ServerSettings.layerTest({
    providerInstances: {
      [instanceId]: {
        driver: provider,
        config: { homePath: "/provider-home" },
        environment: [{ name: "TEST_INSTANCE", value: "selected" }],
      },
    },
  });
  const layers = Layer.mergeAll(
    runtime,
    settingsLayer,
    Layer.succeed(ThreadDeletionReactor, {
      start: () => Effect.void,
      drainThrough: () => Effect.void,
    }),
    Layer.mock(ProviderSessionDirectory)(directory),
    Layer.mock(ProviderService)(providers),
    Layer.mock(ProjectionThreadRepository)(repository),
    Layer.mock(OrchestrationEngineService)(engine),
    Layer.succeed(TransientChatCleanupGate, gate),
  );
  const create = () =>
    makeTransientSideChatCleanup((input) =>
      Effect.gen(function* () {
        assert.equal(binding?.status, "stopped");
        calls.push("provider-delete");
        nativeCalls.push(input);
        if (nativeFails)
          return yield* new TransientChatProviderThreadDeleteError({
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            reason: "unsafe-session",
            message: "Has children",
          });
        if (nativeGone) return "already-absent" as const;
        nativeGone = true;
        return "deleted" as const;
      }),
    ).pipe(Effect.provide(layers));
  return {
    create,
    gate,
    calls,
    nativeCalls,
    layers,
    directory,
    cursor,
    thread: () => thread,
    binding: () => binding,
    stopFails: (value: boolean) => {
      stopFails = value;
    },
    nativeFails: (value: boolean) => {
      nativeFails = value;
    },
  };
});

for (const provider of ["codex", "claudeAgent", "opencode"] as const) {
  it.effect(`cleans ${provider} using its native ID, original instance settings, and cwd`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(provider);
      const cleanup = yield* f.create();
      assert.deepEqual(yield* cleanup({ threadId }), { providerHistory: "deleted" });
      assert.deepEqual(f.calls, ["t3-delete", "stop", "provider-delete"]);
      assert.equal(
        f.nativeCalls[0]?.providerSessionId,
        provider === "opencode" ? "ses_native" : nativeId,
      );
      assert.equal(f.nativeCalls[0]?.environment?.TEST_INSTANCE, "selected");
      assert.equal(f.nativeCalls[0]?.cwd, "/project");
      assert.isNotNull(f.thread().deletedAt);
      const afterRestart = yield* f.create();
      assert.deepEqual(yield* afterRestart({ threadId }), { providerHistory: "already-absent" });
      assert.equal(f.nativeCalls.length, 1);
    }),
  );
}

it.effect(
  "never-started chats are deleted without launching a provider and cannot later start",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture("codex", false);
      const cleanup = yield* f.create();
      assert.deepEqual(yield* cleanup({ threadId }), { providerHistory: "not-started" });
      assert.deepEqual(f.calls, ["t3-delete"]);
      assert.deepInclude(f.binding()?.runtimePayload, { transientSideChatCleanup: "complete" });
    }),
);

it.effect("a failed stop never deletes provider history; a later request retries", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const cleanup = yield* f.create();
    f.stopFails(true);
    yield* Effect.flip(cleanup({ threadId }));
    assert.equal(f.nativeCalls.length, 0);
    assert.deepInclude(f.binding()?.runtimePayload, { transientSideChatCleanup: "pending" });
    f.stopFails(false);
    yield* cleanup({ threadId });
    assert.deepEqual(f.calls, ["t3-delete", "stop", "stop", "provider-delete"]);
  }),
);

it.effect("unsafe provider sessions remain queued; cleanup can resume after a restart", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const cleanup = yield* f.create();
    f.nativeFails(true);
    assert.equal((yield* Effect.flip(cleanup({ threadId }))).reason, "unsafe-session");
    assert.deepInclude(f.binding()?.runtimePayload, { transientSideChatCleanup: "pending" });
    f.nativeFails(false);
    const resumed = yield* f.create();
    yield* resumed({ threadId });
    assert.equal(f.nativeCalls.length, 2);
  }),
);

it.effect("waits for a first session being created before resolving the native ID", () =>
  Effect.gen(function* () {
    const f = yield* fixture("codex", false);
    const cleanup = yield* f.create();
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const admission = yield* f.gate
      .run(
        threadId,
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          yield* f.directory.upsert({
            threadId,
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: instanceId,
            status: "running",
            resumeCursor: f.cursor,
            runtimePayload: { cwd: "/project" },
          });
        }),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);
    const close = yield* cleanup({ threadId }).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.deepEqual(f.calls, []);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(admission);
    yield* Fiber.join(close);
    assert.equal(f.nativeCalls[0]?.providerSessionId, nativeId);
  }),
);

it.effect("other providers keep T3-only cleanup", () =>
  Effect.gen(function* () {
    const f = yield* fixture("cursor");
    const cleanup = yield* f.create();
    assert.deepEqual(yield* cleanup({ threadId }), { providerHistory: "unsupported" });
    assert.deepEqual(f.calls, ["t3-delete", "stop"]);
  }),
);

it.effect("a stopped binding with a missing native ID fails and remains pending", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.directory.upsert({
      threadId,
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: instanceId,
      status: "stopped",
      resumeCursor: null,
    });
    const cleanup = yield* f.create();
    yield* Effect.flip(cleanup({ threadId }));
    yield* Effect.flip(cleanup({ threadId }));
    assert.equal(f.nativeCalls.length, 0);
    assert.deepInclude(f.binding()?.runtimePayload, { transientSideChatCleanup: "pending" });
  }),
);
