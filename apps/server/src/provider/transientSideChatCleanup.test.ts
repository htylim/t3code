import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  OrchestrationV2AppThread,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import type { ProviderAdapterV2SessionRuntime } from "../orchestration-v2/ProviderAdapter.ts";
import { ProviderSessionManagerV2 } from "../orchestration-v2/ProviderSessionManager.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import {
  ProviderSessionRuntimeRepository,
  type ProviderSessionRuntime,
} from "../persistence/ProviderSessionRuntime.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { OpenCodeServerLedger } from "./OpenCodeServerLedger.ts";
import * as OpenCodeRuntime from "./opencodeRuntime.ts";
import { TransientChatProviderThreadDeleteError } from "./transientChatDeletion/errors.ts";
import { makeTransientSideChatCleanup } from "./transientSideChatCleanup.ts";
import type { TransientChatProviderThreadDeleteInput } from "./transientChatProviderThreadDelete.ts";

const threadId = ThreadId.make("transient-side-chat");
const instanceId = ProviderInstanceId.make("test-instance");
const sessionId = ProviderSessionId.make("session-transient");
const nativeId = "11111111-1111-4111-8111-111111111111";
const now = DateTime.makeUnsafe("2026-10-04T12:00:00Z");
const runtimeLayer = OpenCodeRuntime.layer.pipe(
  Layer.provide(Layer.mock(OpenCodeServerLedger)({ track: () => Effect.succeed(Effect.void) })),
  Layer.provideMerge(NodeServices.layer),
);

/** V2 projection and retry storage with a controlled native-history deletion boundary. */
function fixture(driverName = "codex", started = true, ownsNativeDeletion = false) {
  const driver = ProviderDriverKind.make(driverName);
  const appThread = Schema.decodeUnknownSync(OrchestrationV2AppThread)({
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Side chat",
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  });
  let projection: OrchestrationV2ThreadProjection = {
    thread: appThread,
    updatedAt: now,
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerThreads: started
      ? [
          {
            id: ProviderThreadId.make("provider-thread-transient"),
            driver,
            providerInstanceId: instanceId,
            providerSessionId: sessionId,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: { driver, nativeId, strength: "strong" },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        ]
      : [],
    providerSessions: started
      ? [
          {
            id: sessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: "/project",
            model: "test-model",
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
        ]
      : [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
  };
  let marker: ProviderSessionRuntime | undefined;
  let stopFails = false;
  let nativeFails = false;
  let nativeGone = false;
  const calls: string[] = [];
  const nativeCalls: TransientChatProviderThreadDeleteInput[] = [];
  const liveRuntime = {
    unloadThread: () =>
      Effect.sync(() => calls.push("unload")).pipe(
        Effect.andThen(
          Effect.suspend(() => (stopFails ? Effect.fail("Cannot unload") : Effect.void)),
        ),
      ),
    interruptTurn: () => Effect.void,
    ...(ownsNativeDeletion
      ? {
          deleteTransientThreadHistory: () =>
            Effect.gen(function* () {
              calls.push("runtime-delete");
              if (nativeFails) {
                return yield* new TransientChatProviderThreadDeleteError({
                  provider: "codex",
                  providerSessionId: nativeId,
                  reason: "unsafe-session",
                  message: "Has children",
                });
              }
              return "deleted" as const;
            }),
        }
      : {}),
  } as unknown as ProviderAdapterV2SessionRuntime;
  const settingsLayer = ServerSettings.layerTest({
    providerInstances: {
      [instanceId]: {
        driver,
        config: { homePath: "/provider-home" },
        environment: [{ name: "TEST_INSTANCE", value: "selected" }],
      },
    },
  });
  const layers = Layer.mergeAll(
    runtimeLayer,
    settingsLayer,
    Layer.mock(ThreadManagementService)({
      getThreadProjection: () => Effect.sync(() => projection),
      dispatch: () =>
        Effect.sync(() => {
          calls.push("t3-delete");
          projection = { ...projection, thread: { ...projection.thread, deletedAt: now } };
          return { sequence: 1, storedEvents: [] };
        }),
    }),
    Layer.mock(ProjectService)({
      getById: () => Effect.succeed(Option.some({ workspaceRoot: "/project" } as never)),
    }),
    Layer.mock(ProviderSessionRuntimeRepository)({
      getByThreadId: () => Effect.sync(() => Option.fromUndefinedOr(marker)),
      upsert: (runtime) =>
        Effect.sync(() => {
          marker = runtime;
        }),
    }),
    Layer.mock(ProviderSessionManagerV2)({
      get: () =>
        Effect.sync(() =>
          projection.thread.deletedAt === null ? Option.some(liveRuntime) : Option.none(),
        ),
      detach: () =>
        Effect.sync(() => {
          calls.push("detach");
        }),
      close: () =>
        Effect.sync(() => {
          calls.push("close");
        }),
    }),
  );
  let updateSettings: ServerSettings.ServerSettingsService["Service"]["updateSettings"] = () =>
    Effect.die("Create the cleanup handler first.");
  const create = () =>
    Effect.gen(function* () {
      updateSettings = (yield* ServerSettings.ServerSettingsService).updateSettings;
      return yield* makeTransientSideChatCleanup((input) =>
        Effect.gen(function* () {
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
      );
    }).pipe(Effect.provide(layers));
  return {
    create,
    calls,
    nativeCalls,
    changeHome: () =>
      updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath: "/different-home" },
          },
        },
      }),
    layers,
    stopFails: (fails: boolean) => {
      stopFails = fails;
    },
    nativeFails: (fails: boolean) => {
      nativeFails = fails;
    },
  };
}

it.effect("V2 cleanup deletes the T3 thread, unloads native work, and deletes history once", () =>
  Effect.gen(function* () {
    const state = fixture();
    const cleanup = yield* state.create();
    assert.deepEqual(yield* cleanup({ threadId }), { providerHistory: "deleted" });
    assert.deepEqual(state.calls, ["unload", "detach", "t3-delete", "provider-delete"]);
    assert.equal(state.nativeCalls[0]?.providerSessionId, nativeId);
    assert.equal(state.nativeCalls[0]?.cwd, "/project");
    assert.equal(state.nativeCalls[0]?.environment?.TEST_INSTANCE, "selected");
    const afterRestart = yield* state.create();
    assert.deepEqual(yield* afterRestart({ threadId }), { providerHistory: "already-absent" });
    assert.equal(state.nativeCalls.length, 1);
  }),
);

it.effect("a failed unload leaves provider history intact and can be retried", () =>
  Effect.gen(function* () {
    const state = fixture();
    state.stopFails(true);
    const cleanup = yield* state.create();
    assert.equal((yield* Effect.flip(cleanup({ threadId }))).reason, "provider-error");
    assert.equal(state.nativeCalls.length, 0);
    state.stopFails(false);
    assert.equal((yield* cleanup({ threadId })).providerHistory, "deleted");
  }),
);

it.effect("native lineage failures remain retryable after V2 deletion", () =>
  Effect.gen(function* () {
    const state = fixture();
    state.nativeFails(true);
    const cleanup = yield* state.create();
    assert.equal((yield* Effect.flip(cleanup({ threadId }))).reason, "unsafe-session");
    state.nativeFails(false);
    assert.equal((yield* (yield* state.create())({ threadId })).providerHistory, "deleted");
    assert.equal(state.calls.filter((call) => call === "t3-delete").length, 1);
  }),
);

it.effect("cleanup refuses a different provider home on retry", () =>
  Effect.gen(function* () {
    const state = fixture();
    state.nativeFails(true);
    const cleanup = yield* state.create();
    yield* Effect.flip(cleanup({ threadId }));
    yield* state.changeHome();
    assert.equal((yield* Effect.flip(cleanup({ threadId }))).reason, "invalid-target");
    assert.equal(state.nativeCalls.length, 1);
  }),
);

it.effect("never-started chats need no provider configuration or history deletion", () =>
  Effect.gen(function* () {
    const state = fixture("codex", false);
    const cleanup = yield* state.create();
    assert.equal((yield* cleanup({ threadId })).providerHistory, "not-started");
    assert.deepEqual(state.calls, ["t3-delete"]);
  }),
);

it.effect("unsupported provider histories leave an explicit result", () =>
  Effect.gen(function* () {
    const state = fixture("cursor");
    const cleanup = yield* state.create();
    assert.equal((yield* cleanup({ threadId })).providerHistory, "unsupported");
    assert.equal(state.nativeCalls.length, 0);
  }),
);

/** Shared Codex must delete with its owning client instead of spawning a competing writer. */
it.effect(
  "a shared runtime deletes its transient history before detach without a second client",
  () =>
    Effect.gen(function* () {
      const state = fixture("codex", true, true);
      const cleanup = yield* state.create();
      assert.equal((yield* cleanup({ threadId })).providerHistory, "deleted");
      assert.deepEqual(state.calls, ["runtime-delete", "detach", "t3-delete"]);
      assert.equal(state.nativeCalls.length, 0);
      assert.equal((yield* cleanup({ threadId })).providerHistory, "already-absent");
    }),
);

/** A native refusal keeps retry state and leaves the owning runtime available. */
it.effect("an owning runtime lineage refusal remains safe and retryable", () =>
  Effect.gen(function* () {
    const state = fixture("codex", true, true);
    state.nativeFails(true);
    const cleanup = yield* state.create();
    assert.equal((yield* Effect.flip(cleanup({ threadId }))).reason, "unsafe-session");
    assert.deepEqual(state.calls, ["runtime-delete"]);
    state.nativeFails(false);
    assert.equal((yield* cleanup({ threadId })).providerHistory, "deleted");
    assert.equal(state.nativeCalls.length, 0);
  }),
);
