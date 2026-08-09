import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThreadDetailSnapshot,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { vi } from "vite-plus/test";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import * as ServerConfig from "../config.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { makeProviderRegistryMock } from "../provider/testUtils/providerRegistryMock.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import * as GitVcsDriverLive from "../vcs/GitVcsDriver.ts";
import { layer, ThreadControlService } from "./ThreadControlService.ts";
import type { ExecuteGitInput, ExecuteGitResult } from "../vcs/GitVcsDriver.ts";

const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");
const callingThreadId = ThreadId.make("thread-calling");
const archivedThreadId = ThreadId.make("thread-archived");
const providerInstanceId = ProviderInstanceId.make("codex_work");
const base = "1970-01-01T00:00:00.000Z";

const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-local"),
  threadId: callingThreadId,
  providerSessionId: "provider-session",
  providerInstanceId,
  capabilities: new Set(["thread-control"]),
  maxRuntimeMode: "auto",
  controlledThreadIds: new Set<ThreadId>(),
  issuedAt: 0,
};

const controlledInvocation = (
  threadIds: ReadonlyArray<ThreadId>,
  maxRuntimeMode: McpInvocationScope["maxRuntimeMode"] = invocation.maxRuntimeMode,
): McpInvocationScope => ({
  ...invocation,
  maxRuntimeMode,
  controlledThreadIds: new Set(threadIds),
});

const makeMcpSessionRegistryLayer = (
  grantControlledThread: McpSessionRegistry["Service"]["grantControlledThread"] = () =>
    Effect.succeed(true),
) =>
  Layer.succeed(
    McpSessionRegistry,
    McpSessionRegistry.of({
      issue: () => Effect.die("credential issuance is unused"),
      resolve: () => Effect.die("credential resolution is unused"),
      touch: () => Effect.void,
      grantControlledThread,
      revokeProviderSession: () => Effect.void,
      revokeThread: () => Effect.void,
      revokeAll: Effect.void,
    }),
  );

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Project A",
  workspaceRoot: "/workspace/project-a",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: base,
  updatedAt: base,
};

function thread(
  id: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
    runtimeMode: "auto",
    interactionMode: "plan",
    branch: "feature/read-tools",
    worktreePath: "/workspace/project-a-worktree",
    latestTurn: null,
    createdAt: base,
    updatedAt: base,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    titleRegeneration: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    backgroundLiveness: null,
    ...overrides,
  };
}

const running = thread("thread-running", {
  createdAt: "1970-01-01T00:00:01.000Z",
  updatedAt: "1970-01-01T00:00:04.000Z",
  session: {
    threadId: ThreadId.make("thread-running"),
    status: "running",
    providerName: "codex",
    providerInstanceId,
    runtimeMode: "auto",
    activeTurnId: TurnId.make("turn-running"),
    lastError: null,
    updatedAt: "1970-01-01T00:00:04.000Z",
  },
});
const settled = thread("thread-a-settled", {
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-terra" },
  createdAt: "1970-01-01T00:00:02.000Z",
  updatedAt: "1970-01-01T00:00:03.000Z",
  settledOverride: "settled",
  settledAt: "1970-01-01T00:00:03.000Z",
  pinnedAt: "1970-01-01T00:00:03.000Z",
  latestTurn: {
    turnId: TurnId.make("turn-settled"),
    state: "completed",
    requestedAt: "1970-01-01T00:00:02.000Z",
    startedAt: "1970-01-01T00:00:02.000Z",
    completedAt: "1970-01-01T00:00:03.000Z",
    assistantMessageId: null,
  },
});
const sameTimestamp = thread("thread-z-same-time", {
  createdAt: "1970-01-01T00:00:02.000Z",
  updatedAt: "1970-01-01T00:00:03.000Z",
  snoozedAt: "1970-01-01T00:00:02.000Z",
  snoozedUntil: "1970-01-01T00:01:00.000Z",
});
const calling = thread(String(callingThreadId));
const archived = thread(String(archivedThreadId), {
  archivedAt: "1970-01-01T00:00:05.000Z",
  updatedAt: "1970-01-01T00:00:05.000Z",
});

const activeSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 12,
  projects: [project],
  threads: [
    calling,
    settled,
    sameTimestamp,
    running,
    thread("other-project", { projectId: otherProjectId }),
  ],
  updatedAt: base,
};
const archivedSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 12,
  projects: [project],
  threads: [archived],
  updatedAt: base,
};

const availableProvider: ServerProvider = {
  instanceId: providerInstanceId,
  driver: ProviderDriverKind.make("codex"),
  displayName: "Work Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: base,
  availability: "available",
  models: [
    {
      slug: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      shortName: "Sol",
      isCustom: false,
      isDefault: true,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
  supportsThreadFork: false,
};
const { displayName: _availableProviderName, ...availableProviderWithoutDisplayName } =
  availableProvider;
const unavailableProvider: ServerProvider = {
  ...availableProviderWithoutDisplayName,
  instanceId: ProviderInstanceId.make("missing_driver"),
  driver: ProviderDriverKind.make("customDriver"),
  availability: "unavailable",
  enabled: false,
  installed: false,
  status: "disabled",
  auth: { status: "unknown" },
  models: [],
};

function makeTestLayer(
  overrides: Partial<ProjectionSnapshotQueryShape> = {},
  engineOverrides: Partial<OrchestrationEngineShape> = {},
) {
  const getThreadDetailById = vi.fn(() => Effect.die("detail query must not be called"));
  const getThreadDetailSnapshot = vi.fn(() => Effect.die("detail query must not be called"));
  const projection = Layer.mock(ProjectionSnapshotQuery)({
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 12 }),
    getProjectShellById: (id) =>
      Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    getThreadShellById: (id) => {
      const found = activeSnapshot.threads.find((entry) => entry.id === id);
      return Effect.succeed(found === undefined ? Option.none() : Option.some(found));
    },
    getShellSnapshot: () => Effect.succeed(activeSnapshot),
    getArchivedShellSnapshot: () => Effect.succeed(archivedSnapshot),
    getThreadDetailById,
    getThreadDetailSnapshot,
    ...overrides,
  });
  const providers = Layer.succeed(
    ProviderRegistry,
    makeProviderRegistryMock([availableProvider, unavailableProvider]),
  );
  const dispatch = vi.fn(() => Effect.succeed({ sequence: 20 }));
  const engine = Layer.mock(OrchestrationEngineService)({
    dispatch,
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(20),
    ...engineOverrides,
  });
  const git = Layer.mock(GitVcsDriver)({
    execute: () => Effect.die("workspace validation is unused by read tests"),
  });
  return {
    testLayer: layer.pipe(
      Layer.provide(projection),
      Layer.provide(providers),
      Layer.provide(engine),
      Layer.provide(git),
      Layer.provide(makeMcpSessionRegistryLayer()),
      Layer.provide(NodeServices.layer),
    ),
    getThreadDetailById,
    getThreadDetailSnapshot,
    dispatch,
  };
}

const waitThreadId = ThreadId.make("thread-wait");
const secondWaitThreadId = ThreadId.make("thread-wait-second");
const interruptedWaitThreadId = ThreadId.make("thread-wait-interrupted");
const errorWaitThreadId = ThreadId.make("thread-wait-error");
const defaultWaitWakeOn = [
  "completed",
  "interrupted",
  "error",
  "approval",
  "user_input",
  "background_idle",
] as const;

const waitInput = (
  overrides: Partial<{
    readonly threadIds: ReadonlyArray<ThreadId>;
    readonly afterSequence: number;
    readonly timeoutMs: number;
    readonly wakeOn: ReadonlyArray<(typeof defaultWaitWakeOn)[number]>;
    readonly progress: boolean;
  }> = {},
) => ({
  threadIds: overrides.threadIds ?? [waitThreadId],
  timeoutMs: overrides.timeoutMs ?? 30_000,
  wakeOn: overrides.wakeOn ?? defaultWaitWakeOn,
  progress: overrides.progress ?? false,
  ...(overrides.afterSequence === undefined ? {} : { afterSequence: overrides.afterSequence }),
});

const completedWaitThread = (id: ThreadId = waitThreadId) =>
  thread(String(id), {
    latestTurn: {
      turnId: TurnId.make(`turn-${id}`),
      state: "completed",
      requestedAt: base,
      startedAt: base,
      completedAt: base,
      assistantMessageId: null,
    },
    session: {
      threadId: id,
      status: "ready",
      providerName: "codex",
      providerInstanceId,
      runtimeMode: "auto",
      activeTurnId: null,
      lastError: null,
      updatedAt: base,
    },
  });

const eventBase = (sequence: number, targetThreadId: ThreadId) => ({
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  aggregateKind: "thread" as const,
  aggregateId: targetThreadId,
  occurredAt: base,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
});

const sessionEvent = (
  sequence: number,
  status: "ready" | "running" | "error" = "ready",
  targetThreadId: ThreadId = waitThreadId,
): OrchestrationEvent => ({
  ...eventBase(sequence, targetThreadId),
  type: "thread.session-set",
  payload: {
    threadId: targetThreadId,
    session: {
      threadId: targetThreadId,
      status,
      providerName: "codex",
      providerInstanceId,
      runtimeMode: "auto",
      activeTurnId: status === "running" ? TurnId.make(`turn-${sequence}`) : null,
      lastError: status === "error" ? "Provider failed" : null,
      updatedAt: base,
    },
  },
});

const activityEvent = (
  sequence: number,
  kind: string,
  summary: string,
  tone: "info" | "tool" | "approval" | "error" = "info",
): OrchestrationEvent => ({
  ...eventBase(sequence, waitThreadId),
  type: "thread.activity-appended",
  payload: {
    threadId: waitThreadId,
    activity: {
      id: EventId.make(`activity-${sequence}`),
      tone,
      kind,
      summary,
      payload: { secret: "must-not-leak" },
      turnId: null,
      createdAt: base,
    },
  },
});

const assistantMessageEvent = (sequence: number): OrchestrationEvent => ({
  ...eventBase(sequence, waitThreadId),
  type: "thread.message-sent",
  payload: {
    threadId: waitThreadId,
    messageId: `assistant-${sequence}` as never,
    role: "assistant",
    text: "streamed token that must not wake",
    turnId: null,
    streaming: true,
    createdAt: base,
    updatedAt: base,
  },
});

function makeWaitLayer(input: {
  readonly readShell: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<OrchestrationThreadShell>>;
  readonly latestSequence: () => number;
  readonly stream: Stream.Stream<OrchestrationEvent>;
  readonly replayEvents?: ReadonlyArray<OrchestrationEvent>;
  readonly archivedThreads?: ReadonlyArray<OrchestrationThreadShell>;
}) {
  const getThreadDetailById = vi.fn(() => Effect.die("wait must not load thread detail"));
  const getThreadDetailSnapshot = vi.fn(() =>
    Effect.die("wait must not load thread detail snapshot"),
  );
  const readEvents = vi.fn((afterSequence: number, limit = 100) =>
    Stream.fromIterable(
      (input.replayEvents ?? []).filter((event) => event.sequence > afterSequence).slice(0, limit),
    ),
  );
  const getThreadShellById = vi.fn(input.readShell);
  const projection = Layer.mock(ProjectionSnapshotQuery)({
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: input.latestSequence() }),
    getProjectShellById: () => Effect.succeed(Option.some(project)),
    getThreadShellById,
    getShellSnapshot: () => Effect.die("wait must use per-thread shell reads"),
    getArchivedShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: input.latestSequence(),
        projects: [project],
        threads: input.archivedThreads ?? [],
        updatedAt: base,
      }),
    getThreadDetailById,
    getThreadDetailSnapshot,
  });
  const testLayer = layer.pipe(
    Layer.provide(projection),
    Layer.provide(Layer.succeed(ProviderRegistry, makeProviderRegistryMock([availableProvider]))),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        dispatch: () => Effect.die("wait must not dispatch"),
        readEvents,
        streamDomainEvents: input.stream,
        latestSequence: Effect.sync(input.latestSequence),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver)({
        execute: () => Effect.die("wait must not inspect Git"),
      }),
    ),
    Layer.provide(makeMcpSessionRegistryLayer()),
    Layer.provide(NodeServices.layer),
  );
  return {
    testLayer,
    getThreadShellById,
    getThreadDetailById,
    getThreadDetailSnapshot,
    readEvents,
  };
}

const gitResult = (stdout: string, exitCode = 0): ExecuteGitResult => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

interface MutationHarnessInput {
  readonly projectRoot: string;
  readonly callingThread?: OrchestrationThreadShell;
  readonly activeThreads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly archivedThreads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly executeGit?: (input: ExecuteGitInput) => Effect.Effect<ExecuteGitResult, never>;
  readonly dispatch?: OrchestrationEngineShape["dispatch"];
  readonly grantControlledThread?: McpSessionRegistry["Service"]["grantControlledThread"];
}

function makeMutationLayer(input: MutationHarnessInput) {
  const targetProject: OrchestrationProjectShell = {
    ...project,
    workspaceRoot: input.projectRoot,
  };
  const caller =
    input.callingThread ??
    thread(String(callingThreadId), {
      branch: null,
      worktreePath: null,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
    });
  const activeThreads = [caller, ...(input.activeThreads ?? [])];
  const archivedThreads = input.archivedThreads ?? [];
  const projection = Layer.mock(ProjectionSnapshotQuery)({
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 40 }),
    getProjectShellById: (id) =>
      Effect.succeed(id === projectId ? Option.some(targetProject) : Option.none()),
    getThreadShellById: (id) =>
      Effect.succeed(Option.fromNullishOr(activeThreads.find((candidate) => candidate.id === id))),
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 40,
        projects: [targetProject],
        threads: activeThreads,
        updatedAt: base,
      }),
    getArchivedShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 40,
        projects: [targetProject],
        threads: archivedThreads,
        updatedAt: base,
      }),
    getThreadDetailById: () => Effect.die("mutation tests must not load detail"),
    getThreadDetailSnapshot: () => Effect.die("mutation tests must not load detail"),
  });
  const dispatch = input.dispatch ?? vi.fn((_command) => Effect.succeed({ sequence: 41 }));
  return layer.pipe(
    Layer.provide(projection),
    Layer.provide(
      Layer.succeed(
        ProviderRegistry,
        makeProviderRegistryMock(input.providers ?? [availableProvider]),
      ),
    ),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        dispatch,
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(40),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver)({
        execute: input.executeGit ?? (() => Effect.succeed(gitResult("", 128))),
      }),
    ),
    Layer.provide(makeMcpSessionRegistryLayer(input.grantControlledThread)),
    Layer.provide(NodeServices.layer),
  );
}

const runInTemp = <A, E, R>(
  test: (input: {
    readonly root: string;
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-mcp-thread-control-" });
      return yield* test({ root, fileSystem, path });
    }),
  ).pipe(Effect.provide(NodeServices.layer));

it.effect("returns the calling thread context from local shell state", () => {
  const harness = makeTestLayer();
  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const result = yield* service.threadContext(invocation);
    expect(result).toMatchObject({
      environmentId: "environment-local",
      threadId: callingThreadId,
      projectId,
      projectWorkspaceRoot: "/workspace/project-a",
      effectiveWorkspacePath: "/workspace/project-a-worktree",
      providerInstanceId,
      modelSelection: calling.modelSelection,
      runtimeMode: "auto",
      interactionMode: "plan",
      status: { cursor: 12, visibility: "active" },
    });
    expect(harness.getThreadDetailById).not.toHaveBeenCalled();
    expect(harness.getThreadDetailSnapshot).not.toHaveBeenCalled();
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("lists cached provider instances and exact model option descriptors", () => {
  const harness = makeTestLayer();
  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const all = yield* service.modelsList({ includeUnavailable: true });
    expect(all.providers).toHaveLength(2);
    expect(all.providers[0]).toMatchObject({
      instanceId: providerInstanceId,
      driver: "codex",
      label: "Work Codex",
      available: true,
      enabled: true,
      installed: true,
      runtimeStatus: "ready",
      authenticationStatus: "authenticated",
      supportsModelChange: true,
      supportsInteractionMode: true,
      models: [
        {
          slug: "gpt-5.6-sol",
          label: "GPT-5.6 Sol",
          description: "Sol",
          isDefault: true,
          optionDescriptors: availableProvider.models[0]!.capabilities!.optionDescriptors,
        },
      ],
    });
    expect(all.providers[1]?.label).toBe("Custom Driver");
    const usable = yield* service.modelsList({ includeUnavailable: false });
    expect(usable.providers.map(({ instanceId }) => instanceId)).toEqual([providerInstanceId]);

    expect(
      yield* service.validateModelSelection({
        instanceId: unavailableProvider.instanceId,
        model: "anything",
      }),
    ).toMatchObject({ ok: false, code: "provider_unavailable" });
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect(
  "reads one coherent target snapshot when another thread advances the projection head",
  () => {
    const finalMessageId = MessageId.make("assistant-final");
    const detail: OrchestrationThreadDetailSnapshot = {
      snapshotSequence: 17,
      thread: {
        ...calling,
        latestTurn: {
          turnId: TurnId.make("turn-final"),
          state: "completed",
          requestedAt: base,
          startedAt: base,
          completedAt: base,
          assistantMessageId: finalMessageId,
        },
        deletedAt: null,
        messages: [
          {
            id: finalMessageId,
            role: "assistant",
            text: "Persisted final",
            turnId: TurnId.make("turn-final"),
            streaming: false,
            createdAt: base,
            updatedAt: base,
          },
          {
            id: MessageId.make("assistant-streaming"),
            role: "assistant",
            text: "Transient fragment",
            turnId: TurnId.make("turn-next"),
            streaming: true,
            createdAt: "1970-01-01T00:00:01.000Z",
            updatedAt: "1970-01-01T00:00:01.000Z",
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
      },
    };
    const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.some(detail)));
    const getSnapshotSequence = vi.fn(() => Effect.succeed({ snapshotSequence: 18 }));
    const coherentShell = thread(String(callingThreadId), {
      latestTurn: detail.thread.latestTurn,
      hasPendingApprovals: true,
    });
    const harness = makeTestLayer({
      getThreadDetailSnapshot,
      getThreadShellById: () => Effect.succeed(Option.some(coherentShell)),
      getSnapshotSequence,
    });

    return Effect.gen(function* () {
      const service = yield* ThreadControlService;
      const result = yield* service.threadRead(invocation, {
        threadId: callingThreadId,
        view: "final",
        maxBytes: 65_536,
      });

      expect(result.view).toBe("final");
      if (result.view !== "final") throw new Error("unexpected view");
      expect(result.message).toMatchObject({
        id: finalMessageId,
        text: "Persisted final",
        streaming: false,
      });
      expect(result.status).toMatchObject({ status: "waiting_for_approval", cursor: 17 });
      expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
      expect(getSnapshotSequence).not.toHaveBeenCalled();
      expect(harness.getThreadDetailById).not.toHaveBeenCalled();
    }).pipe(Effect.provide(harness.testLayer));
  },
);

it.effect("rejects a thread_read when a new turn lands between detail and status snapshots", () => {
  const finalMessageId = MessageId.make("assistant-raced-final");
  const detail: OrchestrationThreadDetailSnapshot = {
    snapshotSequence: 17,
    thread: {
      ...calling,
      latestTurn: {
        turnId: TurnId.make("turn-raced-completed"),
        state: "completed",
        requestedAt: base,
        startedAt: base,
        completedAt: base,
        assistantMessageId: finalMessageId,
      },
      deletedAt: null,
      messages: [
        {
          id: finalMessageId,
          role: "assistant",
          text: "Old final",
          turnId: TurnId.make("turn-raced-completed"),
          streaming: false,
          createdAt: base,
          updatedAt: base,
        },
      ],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    },
  };
  const runningShell = thread(String(callingThreadId), {
    latestTurn: {
      turnId: TurnId.make("turn-raced-running"),
      state: "running",
      requestedAt: "1970-01-01T00:00:01.000Z",
      startedAt: "1970-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
  });
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.some(detail)));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getThreadShellById: () => Effect.succeed(Option.some(runningShell)),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 18 }),
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: callingThreadId,
        view: "final",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "read_failed",
      operation: "thread_read",
      retryable: true,
      targetThreadId: callingThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("rejects a thread_read when the target turn completes after the detail snapshot", () => {
  const finalMessageId = MessageId.make("assistant-newly-completed");
  const turnId = TurnId.make("turn-completing");
  const detail: OrchestrationThreadDetailSnapshot = {
    snapshotSequence: 17,
    thread: {
      ...calling,
      latestTurn: {
        turnId,
        state: "running",
        requestedAt: base,
        startedAt: base,
        completedAt: null,
        assistantMessageId: null,
      },
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    },
  };
  const completedShell = thread(String(callingThreadId), {
    updatedAt: "1970-01-01T00:00:01.000Z",
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: base,
      startedAt: base,
      completedAt: "1970-01-01T00:00:01.000Z",
      assistantMessageId: finalMessageId,
    },
  });
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.some(detail)));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getThreadShellById: () => Effect.succeed(Option.some(completedShell)),
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: callingThreadId,
        view: "final",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "read_failed",
      operation: "thread_read",
      retryable: true,
      targetThreadId: callingThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("reports archived thread reads as unsupported after one detail lookup", () => {
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.none()));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 17 }),
    getArchivedShellSnapshot: () => Effect.succeed({ ...archivedSnapshot, snapshotSequence: 17 }),
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: archivedThreadId,
        view: "messages",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "thread_archived_read_unsupported",
      operation: "thread_read",
      targetThreadId: archivedThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect(
  "classifies an archived thread while unrelated events advance the projection head",
  () => {
    const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.none()));
    let sequenceReads = 0;
    const getSnapshotSequence = vi.fn(() =>
      Effect.succeed({ snapshotSequence: sequenceReads++ === 0 ? 17 : 18 }),
    );
    const getArchivedShellSnapshot = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed({ ...archivedSnapshot, snapshotSequence: 17 }))
      .mockReturnValue(Effect.succeed({ ...archivedSnapshot, snapshotSequence: 18 }));
    const harness = makeTestLayer({
      getThreadDetailSnapshot,
      getSnapshotSequence,
      getArchivedShellSnapshot,
    });

    return Effect.gen(function* () {
      const service = yield* ThreadControlService;
      const failure = yield* service
        .threadRead(invocation, {
          threadId: archivedThreadId,
          view: "messages",
          maxBytes: 65_536,
        })
        .pipe(Effect.flip);

      expect(failure).toMatchObject({
        code: "thread_archived_read_unsupported",
        operation: "thread_read",
        targetThreadId: archivedThreadId,
      });
      expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
      expect(getSnapshotSequence).not.toHaveBeenCalled();
      expect(getArchivedShellSnapshot).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(harness.testLayer));
  },
);

it.effect("classifies a missing thread while unrelated events advance the projection head", () => {
  const missingThreadId = ThreadId.make("thread-missing");
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.none()));
  const getSnapshotSequence = vi.fn(() => Effect.succeed({ snapshotSequence: 18 }));
  const getArchivedShellSnapshot = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed({ ...archivedSnapshot, snapshotSequence: 17, threads: [] }))
    .mockReturnValue(Effect.succeed({ ...archivedSnapshot, snapshotSequence: 18, threads: [] }));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getSnapshotSequence,
    getArchivedShellSnapshot,
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: missingThreadId,
        view: "messages",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "thread_not_found",
      operation: "thread_read",
      targetThreadId: missingThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
    expect(getSnapshotSequence).not.toHaveBeenCalled();
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("rejects an unarchive during absent-thread classification", () => {
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.none()));
  const getThreadShellById = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed(Option.none()))
    .mockReturnValue(Effect.succeed(Option.some(calling)));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getThreadShellById,
    getArchivedShellSnapshot: () => Effect.succeed(archivedSnapshot),
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: callingThreadId,
        view: "messages",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "read_failed",
      operation: "thread_read",
      retryable: true,
      targetThreadId: callingThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
    expect(getThreadShellById).toHaveBeenCalledTimes(2);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("rejects an archive after a present detail snapshot", () => {
  const detail: OrchestrationThreadDetailSnapshot = {
    snapshotSequence: 17,
    thread: {
      ...calling,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    },
  };
  const getThreadDetailSnapshot = vi.fn(() => Effect.succeed(Option.some(detail)));
  const harness = makeTestLayer({
    getThreadDetailSnapshot,
    getThreadShellById: () => Effect.succeed(Option.none()),
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const failure = yield* service
      .threadRead(invocation, {
        threadId: callingThreadId,
        view: "messages",
        maxBytes: 65_536,
      })
      .pipe(Effect.flip);

    expect(failure).toMatchObject({
      code: "read_failed",
      operation: "thread_read",
      retryable: true,
      targetThreadId: callingThreadId,
    });
    expect(getThreadDetailSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("filters and stably limits active and archived shell metadata", () => {
  const harness = makeTestLayer();
  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const baseInput = { visibility: "active" as const, limit: 50 };

    const active = yield* service.threadsList(invocation, baseInput);
    expect(active.threads.map(({ threadId }) => threadId)).toEqual([
      running.id,
      settled.id,
      sameTimestamp.id,
      calling.id,
    ]);
    expect(active).toMatchObject({
      totalMatched: 4,
      returnedCount: 4,
      truncated: false,
      cursor: 12,
    });

    const limited = yield* service.threadsList(invocation, { ...baseInput, limit: 2 });
    expect(limited).toMatchObject({ totalMatched: 4, returnedCount: 2, truncated: true });
    expect(limited.threads.map(({ threadId }) => threadId)).toEqual([running.id, settled.id]);

    const filtered = yield* service.threadsList(invocation, {
      ...baseInput,
      statuses: ["completed"],
      providerInstanceId,
      model: "gpt-5.6-terra",
      settled: true,
      snoozed: false,
      pinned: true,
      createdAfter: "1970-01-01T00:00:02.000Z",
      createdBefore: "1970-01-01T00:00:03.000Z",
      updatedAfter: "1970-01-01T00:00:03.000Z",
      updatedBefore: "1970-01-01T00:00:04.000Z",
    });
    expect(filtered.threads.map(({ threadId }) => threadId)).toEqual([settled.id]);

    const snoozed = yield* service.threadsList(invocation, {
      ...baseInput,
      snoozed: true,
    });
    expect(snoozed.threads.map(({ threadId }) => threadId)).toEqual([sameTimestamp.id]);

    const all = yield* service.threadsList(invocation, { visibility: "all", limit: 50 });
    expect(all.threads[0]?.threadId).toBe(archivedThreadId);
    expect(all.threads[0]?.visibility).toBe("archived");

    const archivedOnly = yield* service.threadsList(invocation, {
      projectId,
      visibility: "archived",
      limit: 50,
    });
    expect(archivedOnly.threads.map(({ threadId }) => threadId)).toEqual([archivedThreadId]);
    expect(harness.getThreadDetailById).not.toHaveBeenCalled();
    expect(harness.getThreadDetailSnapshot).not.toHaveBeenCalled();
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("reconciles an archive between the active and archived list snapshots", () => {
  const movingActive = thread("thread-moving", { updatedAt: "1970-01-01T00:00:06.000Z" });
  const movingArchived = thread("thread-moving", {
    archivedAt: "1970-01-01T00:00:07.000Z",
    updatedAt: "1970-01-01T00:00:07.000Z",
  });
  const getShellSnapshot = vi
    .fn()
    .mockReturnValueOnce(
      Effect.succeed({ ...activeSnapshot, snapshotSequence: 12, threads: [movingActive] }),
    )
    .mockReturnValue(Effect.succeed({ ...activeSnapshot, snapshotSequence: 13, threads: [] }));
  const getArchivedShellSnapshot = vi.fn(() =>
    Effect.succeed({ ...archivedSnapshot, snapshotSequence: 13, threads: [movingArchived] }),
  );
  const harness = makeTestLayer({ getShellSnapshot, getArchivedShellSnapshot });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const result = yield* service.threadsList(invocation, {
      projectId,
      visibility: "all",
      limit: 50,
    });

    expect(result.threads.map(({ threadId }) => threadId)).toEqual([movingActive.id]);
    expect(result.threads[0]?.visibility).toBe("archived");
    expect(result.cursor).toBe(13);
    expect(getShellSnapshot).toHaveBeenCalledTimes(2);
    expect(getArchivedShellSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("reconciles an unarchive omitted by the first list snapshots", () => {
  const movingActive = thread("thread-moving", { updatedAt: "1970-01-01T00:00:07.000Z" });
  const getShellSnapshot = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed({ ...activeSnapshot, snapshotSequence: 12, threads: [] }))
    .mockReturnValue(
      Effect.succeed({ ...activeSnapshot, snapshotSequence: 13, threads: [movingActive] }),
    );
  const getArchivedShellSnapshot = vi.fn(() =>
    Effect.succeed({ ...archivedSnapshot, snapshotSequence: 13, threads: [] }),
  );
  const harness = makeTestLayer({ getShellSnapshot, getArchivedShellSnapshot });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const result = yield* service.threadsList(invocation, {
      projectId,
      visibility: "all",
      limit: 50,
    });

    expect(result.threads.map(({ threadId }) => threadId)).toEqual([movingActive.id]);
    expect(result.threads[0]?.visibility).toBe("active");
    expect(result.cursor).toBe(13);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect(
  "returns active and archived status and rejects a missing thread without detail reads",
  () => {
    const harness = makeTestLayer();
    return Effect.gen(function* () {
      const service = yield* ThreadControlService;
      const active = yield* service.threadStatus(invocation, running.id);
      expect(active).toMatchObject({
        threadId: running.id,
        status: "running",
        visibility: "active",
        cursor: 12,
      });

      const archivedResult = yield* service.threadStatus(invocation, archivedThreadId);
      expect(archivedResult).toMatchObject({
        threadId: archivedThreadId,
        visibility: "archived",
        cursor: 12,
      });

      const missing = yield* service
        .threadStatus(invocation, ThreadId.make("thread-missing"))
        .pipe(Effect.flip);
      expect(missing).toMatchObject({ code: "thread_not_found", operation: "thread_status" });
      expect(harness.getThreadDetailById).not.toHaveBeenCalled();
      expect(harness.getThreadDetailSnapshot).not.toHaveBeenCalled();
    }).pipe(Effect.provide(harness.testLayer));
  },
);

it.effect("does not report not found when an archived thread is concurrently unarchived", () => {
  const unarchived = thread(String(archivedThreadId), {
    updatedAt: "1970-01-01T00:00:07.000Z",
  });
  const getSnapshotSequence = vi.fn(() => Effect.succeed({ snapshotSequence: 12 }));
  const getThreadShellById = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed(Option.none()))
    .mockReturnValue(Effect.succeed(Option.some(unarchived)));
  const getArchivedShellSnapshot = vi.fn(() =>
    Effect.succeed({ ...archivedSnapshot, snapshotSequence: 13, threads: [] }),
  );
  const harness = makeTestLayer({
    getSnapshotSequence,
    getThreadShellById,
    getArchivedShellSnapshot,
  });

  return Effect.gen(function* () {
    const service = yield* ThreadControlService;
    const result = yield* service.threadStatus(invocation, archivedThreadId);

    expect(result).toMatchObject({
      threadId: archivedThreadId,
      visibility: "active",
      cursor: 12,
    });
    expect(getSnapshotSequence).toHaveBeenCalledTimes(1);
    expect(getThreadShellById).toHaveBeenCalledTimes(2);
    expect(getArchivedShellSnapshot).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.testLayer));
});

it.effect("validates existing Git roots and linked worktrees with fixed read-only commands", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "project");
      const linkedRoot = path.join(root, "linked");
      const detachedRoot = path.join(root, "detached");
      const otherRoot = path.join(root, "other");
      const subdirectory = path.join(projectRoot, "src");
      const projectCommon = path.join(root, "project-common");
      const otherCommon = path.join(root, "other-common");
      const linkedAdmin = path.join(projectCommon, "worktrees", "linked");
      const detachedAdmin = path.join(projectCommon, "worktrees", "detached");
      yield* Effect.forEach(
        [
          projectRoot,
          linkedRoot,
          detachedRoot,
          otherRoot,
          subdirectory,
          projectCommon,
          otherCommon,
          linkedAdmin,
          detachedAdmin,
        ],
        (directory) => fileSystem.makeDirectory(directory, { recursive: true }),
        { discard: true },
      );
      yield* fileSystem.writeFileString(
        path.join(linkedAdmin, "gitdir"),
        `${path.join(linkedRoot, ".git")}\n`,
      );
      yield* fileSystem.writeFileString(
        path.join(detachedAdmin, "gitdir"),
        `${path.join(detachedRoot, ".git")}\n`,
      );

      const gitCalls: Array<ExecuteGitInput> = [];
      const executeGit = (input: ExecuteGitInput) =>
        Effect.sync(() => {
          gitCalls.push(input);
          const command = input.args.join(" ");
          expect([
            "rev-parse --show-toplevel",
            "rev-parse --git-common-dir",
            "rev-parse --absolute-git-dir",
            "worktree list --porcelain -z",
            "symbolic-ref --quiet --short HEAD",
          ]).toContain(command);
          expect(input.allowNonZeroExit).toBe(true);
          if (command === "rev-parse --show-toplevel") {
            if (path.basename(input.cwd) === "src") return gitResult(`${projectRoot}\n`);
            return gitResult(`${input.cwd}\n`);
          }
          if (command === "rev-parse --git-common-dir") {
            return gitResult(
              `${path.basename(input.cwd) === "other" ? otherCommon : projectCommon}\n`,
            );
          }
          if (command === "rev-parse --absolute-git-dir") {
            if (path.basename(input.cwd) === "linked") return gitResult(`${linkedAdmin}\n`);
            if (path.basename(input.cwd) === "detached") return gitResult(`${detachedAdmin}\n`);
            return gitResult(`${projectCommon}\n`);
          }
          if (command === "worktree list --porcelain -z") {
            return gitResult(
              [projectRoot, linkedRoot, detachedRoot]
                .map((worktree) => `worktree ${worktree}\0HEAD test\0\0`)
                .join(""),
            );
          }
          if (path.basename(input.cwd) === "detached") return gitResult("", 1);
          if (path.basename(input.cwd) === "linked") return gitResult("feature/linked\n");
          if (path.basename(input.cwd) === "other") return gitResult("feature/other\n");
          return gitResult("main\n");
        });

      const start = (workspacePath: string, branch?: string) => {
        const commands: Array<unknown> = [];
        let sequence = 40;
        const testLayer = makeMutationLayer({
          projectRoot,
          callingThread: thread(String(callingThreadId), {
            branch: null,
            worktreePath: workspacePath === projectRoot ? null : workspacePath,
          }),
          executeGit,
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: ++sequence };
            }),
        });
        return Effect.gen(function* () {
          const service = yield* ThreadControlService;
          const result = yield* service.threadStart(invocation, {
            prompt: "Review this workspace",
            workspacePath,
            ...(branch === undefined ? {} : { branch }),
          });
          return { result, commands };
        }).pipe(Effect.provide(testLayer));
      };

      const rootStart = yield* start(projectRoot, "main");
      expect(rootStart.result).toMatchObject({ threadCreated: true, promptAccepted: true });
      expect(rootStart.commands[0]).toMatchObject({
        type: "thread.create",
        branch: "main",
        worktreePath: null,
      });

      const linkedStart = yield* start(linkedRoot, "feature/linked");
      expect(linkedStart.commands[0]).toMatchObject({
        type: "thread.create",
        branch: "feature/linked",
        worktreePath: yield* fileSystem.realPath(linkedRoot),
      });

      const detachedStart = yield* start(detachedRoot);
      expect(detachedStart.commands[0]).toMatchObject({
        type: "thread.create",
        branch: null,
        worktreePath: yield* fileSystem.realPath(detachedRoot),
      });

      const crossWorkspaceDispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
      const crossWorkspace = yield* ThreadControlService.pipe(
        Effect.flatMap((service) =>
          service.threadStart(invocation, {
            prompt: "Do not cross workspaces",
            workspacePath: linkedRoot,
          }),
        ),
        Effect.provide(
          makeMutationLayer({
            projectRoot,
            executeGit,
            dispatch: crossWorkspaceDispatch,
          }),
        ),
        Effect.flip,
      );
      expect(crossWorkspace).toMatchObject({
        code: "capability_denied",
        operation: "thread_start",
      });
      expect(crossWorkspaceDispatch).not.toHaveBeenCalled();

      for (const [workspacePath, branch] of [
        [path.join(root, "missing"), undefined],
        [subdirectory, undefined],
        [otherRoot, undefined],
        [linkedRoot, "wrong-branch"],
        [detachedRoot, "feature/detached"],
      ] as const) {
        const failure = yield* start(workspacePath, branch).pipe(Effect.flip);
        expect(failure).toMatchObject({ code: "invalid_workspace", operation: "thread_start" });
      }
      expect(
        gitCalls.every((call) =>
          [
            "rev-parse --show-toplevel",
            "rev-parse --git-common-dir",
            "rev-parse --absolute-git-dir",
            "worktree list --porcelain -z",
            "symbolic-ref --quiet --short HEAD",
          ].includes(call.args.join(" ")),
        ),
      ).toBe(true);
    }),
  ),
);

it.effect("binds real registered worktrees to their own Git administrative directories", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const git = yield* GitVcsDriver;
      const projectRoot = path.join(root, "project");
      const linkedRoot = path.join(root, "linked space-λ");
      const linkedAlias = path.join(root, "linked-alias");
      const detachedRoot = path.join(root, "detached-é");
      const otherLinkedRoot = path.join(root, "other linked");
      const recreatedRoot = path.join(root, "recreated stale");
      const prunableRoot = path.join(root, "missing prunable");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });

      const runGit = (cwd: string, args: ReadonlyArray<string>) =>
        git.execute({
          operation: "ThreadControlService.test.gitFixture",
          cwd,
          args,
        });
      yield* runGit(projectRoot, ["init", "-b", "main"]);
      yield* runGit(projectRoot, ["config", "user.email", "mcp-test@example.com"]);
      yield* runGit(projectRoot, ["config", "user.name", "MCP Test"]);
      yield* fileSystem.writeFileString(path.join(projectRoot, "seed"), "seed\n");
      yield* runGit(projectRoot, ["add", "seed"]);
      yield* runGit(projectRoot, ["commit", "-m", "seed"]);
      yield* runGit(projectRoot, ["worktree", "add", "-b", "feature/linked", linkedRoot]);
      yield* runGit(projectRoot, ["worktree", "add", "--detach", detachedRoot, "HEAD"]);
      yield* runGit(projectRoot, ["worktree", "add", "-b", "feature/other", otherLinkedRoot]);
      yield* runGit(projectRoot, ["worktree", "add", "-b", "feature/recreated", recreatedRoot]);
      yield* runGit(projectRoot, ["worktree", "add", "-b", "feature/prunable", prunableRoot]);
      yield* fileSystem.symlink(linkedRoot, linkedAlias);

      const linkedPointer = yield* fileSystem.readFileString(path.join(linkedRoot, ".git"));
      const otherGitDir = yield* runGit(otherLinkedRoot, ["rev-parse", "--absolute-git-dir"]);
      yield* fileSystem.remove(recreatedRoot, { recursive: true, force: true });
      yield* fileSystem.makeDirectory(recreatedRoot, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(recreatedRoot, ".git"),
        `gitdir: ${path.join(projectRoot, ".git")}\n`,
      );
      const canonicalPrunableRoot = yield* fileSystem.realPath(prunableRoot);
      yield* fileSystem.remove(prunableRoot, { recursive: true, force: true });
      const worktrees = yield* runGit(projectRoot, ["worktree", "list", "--porcelain"]);
      expect(worktrees.stdout).toContain(`worktree ${canonicalPrunableRoot}\n`);
      expect(worktrees.stdout).toContain("prunable gitdir file points to non-existent location");

      const dispatch = vi.fn((_command: OrchestrationCommand) => Effect.succeed({ sequence: 1 }));
      const start = (workspacePath: string, branch?: string) =>
        ThreadControlService.pipe(
          Effect.flatMap((service) =>
            service.threadStart(invocation, {
              prompt: "Use this registered worktree",
              workspacePath,
              ...(branch === undefined ? {} : { branch }),
            }),
          ),
          Effect.provide(
            makeMutationLayer({
              projectRoot,
              callingThread: thread(String(callingThreadId), {
                branch: null,
                worktreePath: workspacePath === projectRoot ? null : workspacePath,
              }),
              executeGit: (input) => git.execute(input).pipe(Effect.orDie),
              dispatch,
            }),
          ),
        );

      const main = yield* start(projectRoot, "main");
      expect(main).toMatchObject({ threadCreated: true, promptAccepted: true });
      const linked = yield* start(linkedRoot, "feature/linked");
      expect(linked).toMatchObject({ threadCreated: true, promptAccepted: true });
      const alias = yield* start(linkedAlias);
      expect(alias).toMatchObject({ threadCreated: true, promptAccepted: true });
      const detached = yield* start(detachedRoot);
      expect(detached).toMatchObject({ threadCreated: true, promptAccepted: true });
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ worktreePath: null, branch: "main" });
      expect(dispatch.mock.calls[4]?.[0]).toMatchObject({
        worktreePath: yield* fileSystem.realPath(linkedRoot),
        branch: "feature/linked",
      });
      expect(dispatch.mock.calls[6]?.[0]).toMatchObject({
        worktreePath: yield* fileSystem.realPath(detachedRoot),
        branch: null,
      });

      for (const forgedGitDir of [
        path.join(projectRoot, ".git"),
        otherGitDir.stdout.replace(/\r?\n$/, ""),
      ]) {
        yield* fileSystem.writeFileString(
          path.join(linkedRoot, ".git"),
          `gitdir: ${forgedGitDir}\n`,
        );
        const forged = yield* start(linkedRoot).pipe(Effect.flip);
        expect(forged).toMatchObject({
          code: "invalid_workspace",
          operation: "thread_start",
          message: "The requested workspace does not use its registered Git worktree metadata.",
        });
      }
      yield* fileSystem.writeFileString(path.join(linkedRoot, ".git"), linkedPointer);

      const recreated = yield* start(recreatedRoot).pipe(Effect.flip);
      expect(recreated).toMatchObject({
        code: "invalid_workspace",
        operation: "thread_start",
        message: "The requested workspace does not use its registered Git worktree metadata.",
      });
      expect(dispatch).toHaveBeenCalledTimes(8);
    }),
  ).pipe(
    Effect.provide(
      GitVcsDriverLive.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-git-test-" })),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);

it.effect("restricts non-Git projects to their exact root without a branch", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "plain-project");
      const otherRoot = path.join(root, "other-directory");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      yield* fileSystem.makeDirectory(otherRoot, { recursive: true });
      const dispatched: Array<OrchestrationCommand> = [];
      const dispatch = vi.fn((command: OrchestrationCommand) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: 1 };
        }),
      );
      const testLayer = makeMutationLayer({ projectRoot, dispatch });
      const runStart = (workspacePath: string, branch?: string) =>
        ThreadControlService.pipe(
          Effect.flatMap((service) =>
            service.threadStart(invocation, {
              prompt: "Review",
              workspacePath,
              ...(branch === undefined ? {} : { branch }),
            }),
          ),
          Effect.provide(testLayer),
        );

      expect(yield* runStart(projectRoot)).toMatchObject({
        threadCreated: true,
        promptAccepted: true,
      });
      expect(dispatched[0]).toMatchObject({
        type: "thread.create",
        branch: null,
        worktreePath: null,
      });
      expect(yield* runStart(otherRoot).pipe(Effect.flip)).toMatchObject({
        code: "invalid_workspace",
      });
      expect(yield* runStart(projectRoot, "main").pipe(Effect.flip)).toMatchObject({
        code: "invalid_workspace",
      });
      expect(dispatch).toHaveBeenCalledTimes(2);
    }),
  ),
);

it.effect("routes thread starts identically for every provider instance", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "provider-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const providerCases = ["codex", "claudeAgent", "cursor", "grok", "opencode"] as const;

      for (const providerName of providerCases) {
        const instanceId = ProviderInstanceId.make(`${providerName}-instance`);
        const provider: ServerProvider = {
          ...availableProvider,
          instanceId,
          driver: ProviderDriverKind.make(providerName),
          models: [{ ...availableProvider.models[0]!, slug: `${providerName}-model` }],
        };
        const selection: ModelSelection = {
          instanceId,
          model: `${providerName}-model`,
        };
        const caller = thread(String(callingThreadId), {
          branch: null,
          worktreePath: null,
          modelSelection: selection,
          runtimeMode: "auto",
          interactionMode: "plan",
        });
        const commands: Array<Parameters<OrchestrationEngineShape["dispatch"]>[0]> = [];
        let sequence = 50;
        const testLayer = makeMutationLayer({
          projectRoot,
          callingThread: caller,
          providers: [provider],
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: ++sequence };
            }),
        });
        const result = yield* ThreadControlService.pipe(
          Effect.flatMap((service) =>
            service.threadStart(invocation, { prompt: `Run ${providerName}` }),
          ),
          Effect.provide(testLayer),
        );

        expect(result).toMatchObject({ threadCreated: true, promptAccepted: true, cursor: 52 });
        expect(commands.map(({ type }) => type)).toEqual(["thread.create", "thread.turn.start"]);
        expect(commands[0]).toMatchObject({
          type: "thread.create",
          projectId,
          title: "New thread",
          modelSelection: selection,
          runtimeMode: "auto",
          interactionMode: "plan",
          branch: null,
          worktreePath: null,
        });
        expect(commands[1]).toMatchObject({
          type: "thread.turn.start",
          modelSelection: selection,
          runtimeMode: "auto",
          interactionMode: "plan",
          message: { role: "user", text: `Run ${providerName}`, attachments: [] },
        });
        expect("bootstrap" in commands[1]!).toBe(false);
        const createCommand = commands[0];
        const turnCommand = commands[1];
        if (createCommand?.type !== "thread.create" || turnCommand?.type !== "thread.turn.start") {
          throw new Error("Expected thread.create followed by thread.turn.start");
        }
        expect(createCommand.createdAt).toBe(turnCommand.createdAt);
      }
    }),
  ),
);

it.effect("preflights model and workspace inputs before creating a thread", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "preflight-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
      const executeGit = vi.fn(() => Effect.succeed(gitResult("", 128)));
      const testLayer = makeMutationLayer({ projectRoot, dispatch, executeGit });
      const service = yield* ThreadControlService.pipe(Effect.provide(testLayer));

      const invalidModel = yield* service
        .threadStart(invocation, {
          prompt: "Do not create",
          workspacePath: path.join(root, "missing"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("unavailable-instance"),
            model: "missing",
          },
        })
        .pipe(Effect.flip);
      expect(invalidModel).toMatchObject({ code: "provider_unavailable" });
      expect(executeGit).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();

      const invalidWorkspace = yield* service
        .threadStart(invocation, {
          prompt: "Still do not create",
          workspacePath: path.join(root, "missing"),
        })
        .pipe(Effect.flip);
      expect(invalidWorkspace).toMatchObject({ code: "invalid_workspace" });
      expect(dispatch).not.toHaveBeenCalled();
    }),
  ),
);

it.effect("reports create rejection and create-then-turn partial failure distinctly", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "partial-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const rejection = () =>
        new OrchestrationCommandInvariantError({
          commandType: "thread.turn.start",
          detail: "rejected for test",
        });

      const createRejectedCalls: Array<string> = [];
      const createRejectedLayer = makeMutationLayer({
        projectRoot,
        dispatch: (command) =>
          Effect.sync(() => createRejectedCalls.push(command.type)).pipe(
            Effect.andThen(Effect.fail(rejection())),
          ),
      });
      const createRejected = yield* ThreadControlService.pipe(
        Effect.flatMap((service) => service.threadStart(invocation, { prompt: "Start" })),
        Effect.provide(createRejectedLayer),
        Effect.flip,
      );
      expect(createRejected).toMatchObject({
        code: "dispatch_rejected",
        operation: "thread_start",
      });
      expect(createRejectedCalls).toEqual(["thread.create"]);

      const partialCalls: Array<string> = [];
      const partialLayer = makeMutationLayer({
        projectRoot,
        dispatch: (command) =>
          Effect.sync(() => {
            partialCalls.push(command.type);
            return partialCalls.length;
          }).pipe(
            Effect.flatMap((sequence) =>
              sequence === 2 ? Effect.fail(rejection()) : Effect.succeed({ sequence }),
            ),
          ),
      });
      const partial = yield* ThreadControlService.pipe(
        Effect.flatMap((service) => service.threadStart(invocation, { prompt: "Start" })),
        Effect.provide(partialLayer),
        Effect.flip,
      );
      expect(partial).toMatchObject({
        code: "partial_failure",
        operation: "thread_start",
        acceptedSteps: { threadCreated: true, promptAccepted: false },
        lastCursor: 1,
      });
      expect(partial.targetThreadId).toBeDefined();
      expect(partialCalls).toEqual(["thread.create", "thread.turn.start"]);
    }),
  ),
);

it.effect("grants control before creating a child and rejects broader project authority", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "authority-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const events: Array<string> = [];
      const commands: Array<OrchestrationCommand> = [];
      const dispatch = vi.fn((command: OrchestrationCommand) =>
        Effect.sync(() => {
          events.push(`dispatch:${command.type}`);
          commands.push(command);
          return { sequence: commands.length };
        }),
      );
      const grantControlledThread = vi.fn((providerSessionId: string, threadId: ThreadId) =>
        Effect.sync(() => {
          events.push(`grant:${threadId}`);
          expect(providerSessionId).toBe(invocation.providerSessionId);
          return true;
        }),
      );
      const service = yield* ThreadControlService.pipe(
        Effect.provide(makeMutationLayer({ projectRoot, dispatch, grantControlledThread })),
      );

      const started = yield* service.threadStart(invocation, { prompt: "Stay in scope" });
      expect(events).toEqual([
        `grant:${started.threadId}`,
        "dispatch:thread.create",
        "dispatch:thread.turn.start",
      ]);
      expect(commands[0]).toMatchObject({ threadId: started.threadId, projectId });

      const crossProject = yield* service
        .threadStart(invocation, {
          prompt: "Do not cross projects",
          projectId: otherProjectId,
        })
        .pipe(Effect.flip);
      expect(crossProject).toMatchObject({
        code: "capability_denied",
        operation: "thread_start",
        targetProjectId: otherProjectId,
      });
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(grantControlledThread).toHaveBeenCalledTimes(1);
    }),
  ),
);

it.effect("enforces child ownership and the credential runtime-mode ceiling", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "ceiling-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const target = thread("thread-owned-target", { branch: null, worktreePath: null });
      const elevatedTarget = thread("thread-owned-elevated", {
        branch: null,
        worktreePath: null,
        runtimeMode: "full-access",
      });
      const dispatch = vi.fn((_command: OrchestrationCommand) => Effect.succeed({ sequence: 1 }));
      const service = yield* ThreadControlService.pipe(
        Effect.provide(
          makeMutationLayer({
            projectRoot,
            activeThreads: [target, elevatedTarget],
            dispatch,
          }),
        ),
      );

      const unowned = yield* service
        .threadSend(invocation, { threadId: target.id, message: "Not mine" })
        .pipe(Effect.flip);
      expect(unowned).toMatchObject({ code: "capability_denied", targetThreadId: target.id });

      const ownedByAuto = controlledInvocation([target.id, elevatedTarget.id]);
      const startEscalation = yield* service
        .threadStart(invocation, { prompt: "Escalate", runtimeMode: "full-access" })
        .pipe(Effect.flip);
      expect(startEscalation).toMatchObject({ code: "capability_denied" });
      const sendEscalation = yield* service
        .threadSend(ownedByAuto, {
          threadId: target.id,
          message: "Escalate",
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip);
      expect(sendEscalation).toMatchObject({ code: "capability_denied" });
      const existingElevated = yield* service
        .threadSend(ownedByAuto, {
          threadId: elevatedTarget.id,
          message: "Use someone else's elevation",
        })
        .pipe(Effect.flip);
      expect(existingElevated).toMatchObject({ code: "capability_denied" });
      const updateEscalation = yield* service
        .threadUpdate(ownedByAuto, {
          threadId: target.id,
          action: "set_runtime_mode",
          runtimeMode: "full-access",
        })
        .pipe(Effect.flip);
      expect(updateEscalation).toMatchObject({ code: "capability_denied" });
      expect(dispatch).not.toHaveBeenCalled();

      yield* service.threadSend(ownedByAuto, {
        threadId: target.id,
        message: "Allowed at the same ceiling",
        runtimeMode: "auto",
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
    }),
  ),
);

it.effect("orders follow-up settings before the ordinary turn and stops on failure", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "send-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const target = thread("thread-target", {
        branch: null,
        worktreePath: null,
        session: {
          threadId: ThreadId.make("thread-target"),
          status: "running",
          providerName: "codex",
          providerInstanceId,
          runtimeMode: "auto",
          activeTurnId: TurnId.make("turn-running"),
          lastError: null,
          updatedAt: base,
        },
      });
      const selection: ModelSelection = {
        instanceId: providerInstanceId,
        model: "gpt-5.6-sol",
        options: [{ id: "effort", value: "high" }],
      };
      const commands: Array<Parameters<OrchestrationEngineShape["dispatch"]>[0]> = [];
      let sequence = 60;
      const testLayer = makeMutationLayer({
        projectRoot,
        activeThreads: [target],
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: ++sequence };
          }),
      });
      const result = yield* ThreadControlService.pipe(
        Effect.flatMap((service) =>
          service.threadSend(controlledInvocation([target.id], "full-access"), {
            threadId: target.id,
            message: "Follow up while running",
            modelSelection: selection,
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        ),
        Effect.provide(testLayer),
      );
      expect(commands.map(({ type }) => type)).toEqual([
        "thread.meta.update",
        "thread.runtime-mode.set",
        "thread.interaction-mode.set",
        "thread.turn.start",
      ]);
      expect(commands[3]).toMatchObject({
        type: "thread.turn.start",
        threadId: target.id,
        modelSelection: selection,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      expect(result).toMatchObject({
        modelUpdateAccepted: true,
        modelUpdateSequence: 61,
        runtimeModeUpdateAccepted: true,
        runtimeModeUpdateSequence: 62,
        interactionModeUpdateAccepted: true,
        interactionModeUpdateSequence: 63,
        messageAccepted: true,
        messageSequence: 64,
        cursor: 64,
      });

      const failedCommands: Array<string> = [];
      const failedLayer = makeMutationLayer({
        projectRoot,
        activeThreads: [target],
        dispatch: (command) => {
          failedCommands.push(command.type);
          return failedCommands.length === 2
            ? Effect.fail(
                new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "stop here",
                }),
              )
            : Effect.succeed({ sequence: 70 });
        },
      });
      const failure = yield* ThreadControlService.pipe(
        Effect.flatMap((service) =>
          service.threadSend(controlledInvocation([target.id], "full-access"), {
            threadId: target.id,
            message: "Do not send after failure",
            modelSelection: selection,
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        ),
        Effect.provide(failedLayer),
        Effect.flip,
      );
      expect(failedCommands).toEqual(["thread.meta.update", "thread.runtime-mode.set"]);
      expect(failure).toMatchObject({
        code: "partial_failure",
        acceptedSteps: {
          modelUpdate: true,
          runtimeModeUpdate: false,
          interactionModeUpdate: false,
          message: false,
        },
        lastCursor: 70,
      });
    }),
  ),
);

it.effect("reports settings accepted when the follow-up turn itself is rejected", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "send-partial-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const target = thread("thread-send-partial", { branch: null, worktreePath: null });
      const commands: Array<string> = [];
      const testLayer = makeMutationLayer({
        projectRoot,
        activeThreads: [target],
        dispatch: (command) => {
          commands.push(command.type);
          return command.type === "thread.turn.start"
            ? Effect.fail(
                new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "turn rejected",
                }),
              )
            : Effect.succeed({ sequence: 81 });
        },
      });
      const failure = yield* ThreadControlService.pipe(
        Effect.flatMap((service) =>
          service.threadSend(controlledInvocation([target.id], "full-access"), {
            threadId: target.id,
            message: "Rejected follow-up",
            runtimeMode: "full-access",
          }),
        ),
        Effect.provide(testLayer),
        Effect.flip,
      );
      expect(commands).toEqual(["thread.runtime-mode.set", "thread.turn.start"]);
      expect(failure).toMatchObject({
        code: "partial_failure",
        acceptedSteps: { runtimeModeUpdate: true, message: false },
        lastCursor: 81,
      });
    }),
  ),
);

it.effect("rejects self-interruption before dispatch and interrupts another active thread", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "interrupt-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const target = thread("thread-interrupt-target", { branch: null, worktreePath: null });
      const dispatched: Array<OrchestrationCommand> = [];
      const dispatch = vi.fn((command: OrchestrationCommand) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: 91 };
        }),
      );
      const service = yield* ThreadControlService.pipe(
        Effect.provide(makeMutationLayer({ projectRoot, activeThreads: [target], dispatch })),
      );
      const selfFailure = yield* service
        .threadInterrupt(invocation, { threadId: callingThreadId })
        .pipe(Effect.flip);
      expect(selfFailure).toMatchObject({ code: "self_interrupt_unsupported" });
      expect(dispatch).not.toHaveBeenCalled();

      const result = yield* service.threadInterrupt(controlledInvocation([target.id]), {
        threadId: target.id,
        turnId: TurnId.make("turn-specific"),
      });
      expect(result).toEqual({ threadId: target.id, accepted: true, cursor: 91 });
      expect(dispatched[0]).toMatchObject({
        type: "thread.turn.interrupt",
        threadId: target.id,
        turnId: "turn-specific",
      });
    }),
  ),
);

it.effect("maps every tagged update action to one ordinary orchestration command", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const projectRoot = path.join(root, "update-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const target = thread("thread-update-target", { branch: null, worktreePath: null });
      const commands: Array<Parameters<OrchestrationEngineShape["dispatch"]>[0]> = [];
      let sequence = 100;
      const service = yield* ThreadControlService.pipe(
        Effect.provide(
          makeMutationLayer({
            projectRoot,
            activeThreads: [target],
            dispatch: (command) =>
              Effect.sync(() => {
                commands.push(command);
                return { sequence: ++sequence };
              }),
          }),
        ),
      );
      const modelSelection: ModelSelection = {
        instanceId: providerInstanceId,
        model: "gpt-5.6-sol",
        options: [{ id: "effort", value: "high" }],
      };
      const actions = [
        { input: { threadId: target.id, action: "settle" as const }, type: "thread.settle" },
        { input: { threadId: target.id, action: "unsettle" as const }, type: "thread.unsettle" },
        {
          input: {
            threadId: target.id,
            action: "snooze" as const,
            snoozedUntil: "1970-01-01T01:00:00.000Z",
          },
          type: "thread.snooze",
        },
        { input: { threadId: target.id, action: "unsnooze" as const }, type: "thread.unsnooze" },
        { input: { threadId: target.id, action: "pin" as const }, type: "thread.pin" },
        { input: { threadId: target.id, action: "unpin" as const }, type: "thread.unpin" },
        {
          input: { threadId: target.id, action: "rename" as const, title: "Renamed" },
          type: "thread.meta.update",
        },
        {
          input: { threadId: target.id, action: "regenerate_title" as const },
          type: "thread.meta.update",
        },
        {
          input: { threadId: target.id, action: "set_model" as const, modelSelection },
          type: "thread.meta.update",
        },
        {
          input: {
            threadId: target.id,
            action: "set_runtime_mode" as const,
            runtimeMode: "full-access" as const,
          },
          type: "thread.runtime-mode.set",
        },
        {
          input: {
            threadId: target.id,
            action: "set_interaction_mode" as const,
            interactionMode: "default" as const,
          },
          type: "thread.interaction-mode.set",
        },
      ];

      for (const action of actions) {
        const result = yield* service.threadUpdate(
          controlledInvocation([target.id], "full-access"),
          action.input,
        );
        expect(result).toMatchObject({ threadId: target.id, accepted: true });
      }
      expect(commands.map(({ type }) => type)).toEqual(actions.map(({ type }) => type));
      expect(commands[1]).toMatchObject({ reason: "user" });
      expect(commands[2]).toMatchObject({ snoozedUntil: "1970-01-01T01:00:00.000Z" });
      expect(commands[3]).toMatchObject({ reason: "user" });
      expect(commands[6]).toMatchObject({ title: "Renamed" });
      expect(commands[7]).toMatchObject({ regenerateTitle: true });
      expect(commands[8]).toMatchObject({ modelSelection });
      expect(commands[9]).toMatchObject({ runtimeMode: "full-access" });
      expect(commands[10]).toMatchObject({ interactionMode: "default" });

      const pastSnooze = yield* service
        .threadUpdate(controlledInvocation([target.id], "full-access"), {
          threadId: target.id,
          action: "snooze",
          snoozedUntil: "1970-01-01T00:00:00.000Z",
        })
        .pipe(Effect.flip);
      expect(pastSnooze).toMatchObject({ code: "invalid_request" });
      expect(commands).toHaveLength(actions.length);
    }),
  ),
);

it.effect("rejects archived and missing mutation targets without dispatch", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      const projectRoot = path.join(root, "target-validation-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const archivedTarget = thread("thread-mutation-archived", {
        archivedAt: "1970-01-01T00:00:01.000Z",
      });
      const dispatch = vi.fn(() => Effect.succeed({ sequence: 1 }));
      const service = yield* ThreadControlService.pipe(
        Effect.provide(
          makeMutationLayer({ projectRoot, archivedThreads: [archivedTarget], dispatch }),
        ),
      );
      const missingThreadId = ThreadId.make("thread-missing");
      const owned = controlledInvocation([archivedTarget.id, missingThreadId]);
      expect(
        yield* service
          .threadSend(owned, { threadId: archivedTarget.id, message: "No" })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "thread_archived" });
      expect(
        yield* service
          .threadUpdate(owned, {
            threadId: missingThreadId,
            action: "pin",
          })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "thread_not_found" });
      expect(dispatch).not.toHaveBeenCalled();
    }),
  ),
);

it.effect("reads an accepted start back through the ordinary shell projection", () =>
  runInTemp(({ root, fileSystem, path }) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const projectRoot = path.join(root, "projection-project");
      yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
      const targetProject = { ...project, workspaceRoot: projectRoot };
      const caller = thread(String(callingThreadId), { branch: null, worktreePath: null });
      const projectedThreads: Array<OrchestrationThreadShell> = [caller];
      let sequence = 120;
      const projection = Layer.mock(ProjectionSnapshotQuery)({
        getSnapshotSequence: () => Effect.succeed({ snapshotSequence: sequence }),
        getProjectShellById: (id) =>
          Effect.succeed(id === projectId ? Option.some(targetProject) : Option.none()),
        getThreadShellById: (id) =>
          Effect.succeed(
            Option.fromNullishOr(projectedThreads.find((candidate) => candidate.id === id)),
          ),
        getShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: sequence,
            projects: [targetProject],
            threads: projectedThreads,
            updatedAt: base,
          }),
        getArchivedShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: sequence,
            projects: [targetProject],
            threads: [],
            updatedAt: base,
          }),
        getThreadDetailById: () => Effect.die("mutation projection proof must stay shell-only"),
        getThreadDetailSnapshot: () => Effect.die("mutation projection proof must stay shell-only"),
      });
      const testLayer = layer.pipe(
        Layer.provide(projection),
        Layer.provide(
          Layer.succeed(ProviderRegistry, makeProviderRegistryMock([availableProvider])),
        ),
        Layer.provide(
          Layer.mock(OrchestrationEngineService)({
            dispatch: (command) =>
              Effect.sync(() => {
                sequence += 1;
                if (command.type === "thread.create") {
                  projectedThreads.push(
                    thread(String(command.threadId), {
                      projectId: command.projectId,
                      title: command.title,
                      modelSelection: command.modelSelection,
                      runtimeMode: command.runtimeMode,
                      interactionMode: command.interactionMode,
                      branch: command.branch,
                      worktreePath: command.worktreePath,
                      createdAt: command.createdAt,
                      updatedAt: command.createdAt,
                    }),
                  );
                } else if (command.type === "thread.turn.start") {
                  const projected = projectedThreads.find(
                    (candidate) => candidate.id === command.threadId,
                  );
                  if (projected !== undefined) {
                    Object.assign(projected, {
                      latestUserMessageAt: command.createdAt,
                      updatedAt: command.createdAt,
                    });
                  }
                }
                return { sequence };
              }),
            readEvents: () => Stream.empty,
            streamDomainEvents: Stream.empty,
            latestSequence: Effect.sync(() => sequence),
          }),
        ),
        Layer.provide(
          Layer.mock(GitVcsDriver)({
            execute: () => Effect.succeed(gitResult("", 128)),
          }),
        ),
        Layer.provide(makeMcpSessionRegistryLayer()),
        Layer.provide(NodeServices.layer),
      );
      const service = yield* ThreadControlService.pipe(Effect.provide(testLayer));
      const started = yield* service.threadStart(invocation, {
        prompt: "Appear in the normal projection",
        title: "Projected MCP thread",
      });
      const status = yield* service.threadStatus(invocation, started.threadId!);
      expect(status).toMatchObject({
        threadId: started.threadId,
        projectId,
        title: "Projected MCP thread",
        visibility: "active",
        status: "queued",
        cursor: started.cursor,
      });
    }),
  ),
);

it.effect("attaches before the snapshot and observes an event published during the read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const attached = yield* Deferred.make<void>();
      const eventObserved = yield* Deferred.make<void>();
      const snapshotStarted = yield* Deferred.make<void>();
      const releaseSnapshot = yield* Deferred.make<void>();
      let head = 10;
      let current = thread(String(waitThreadId));
      let reads = 0;
      const stream = Stream.unwrap(
        Deferred.succeed(attached, undefined).pipe(Effect.as(Stream.fromQueue(events))),
      ).pipe(Stream.tap(() => Deferred.succeed(eventObserved, undefined)));
      const harness = makeWaitLayer({
        latestSequence: () => head,
        stream,
        readShell: () => {
          const captured = current;
          reads += 1;
          if (reads !== 1) return Effect.succeed(Option.some(captured));
          return Deferred.poll(attached).pipe(
            Effect.tap((subscription) =>
              Effect.sync(() => expect(Option.isSome(subscription)).toBe(true)),
            ),
            Effect.andThen(Deferred.succeed(snapshotStarted, undefined)),
            Effect.andThen(Deferred.await(releaseSnapshot)),
            Effect.as(Option.some(captured)),
          );
        },
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 10 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(snapshotStarted);
      yield* Effect.yieldNow;
      current = completedWaitThread();
      head = 11;
      yield* Queue.offer(events, sessionEvent(11));
      yield* Deferred.await(eventObserved);
      yield* Deferred.succeed(releaseSnapshot, undefined);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");

      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({
        reason: "condition",
        cursor: 11,
        resynchronized: false,
        matched: [{ threadId: waitThreadId, conditions: ["completed"] }],
      });
      expect(reads).toBe(2);
    }),
  ),
);

it.effect("returns current terminal and blocked conditions without entering the live wait", () =>
  Effect.gen(function* () {
    const blocked = thread(String(secondWaitThreadId), {
      hasPendingApprovals: true,
      hasPendingUserInput: true,
    });
    const shells = new Map<ThreadId, OrchestrationThreadShell>([
      [waitThreadId, completedWaitThread()],
      [secondWaitThreadId, blocked],
      [
        interruptedWaitThreadId,
        thread(String(interruptedWaitThreadId), {
          latestTurn: {
            turnId: TurnId.make("turn-interrupted"),
            state: "interrupted",
            requestedAt: base,
            startedAt: base,
            completedAt: base,
            assistantMessageId: null,
          },
        }),
      ],
      [
        errorWaitThreadId,
        thread(String(errorWaitThreadId), {
          latestTurn: {
            turnId: TurnId.make("turn-error"),
            state: "error",
            requestedAt: base,
            startedAt: base,
            completedAt: base,
            assistantMessageId: null,
          },
        }),
      ],
    ]);
    const harness = makeWaitLayer({
      latestSequence: () => 20,
      stream: Stream.never,
      readShell: (threadId) => Effect.succeed(Option.fromNullishOr(shells.get(threadId))),
    });
    const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
    const result = yield* service.threadsWait(
      invocation,
      waitInput({
        threadIds: [waitThreadId, secondWaitThreadId, interruptedWaitThreadId, errorWaitThreadId],
      }),
    );

    expect(result.reason).toBe("condition");
    expect(result.cursor).toBe(20);
    expect(result.matched).toEqual([
      { threadId: waitThreadId, conditions: ["completed"] },
      { threadId: secondWaitThreadId, conditions: ["approval", "user_input"] },
      { threadId: interruptedWaitThreadId, conditions: ["interrupted"] },
      { threadId: errorWaitThreadId, conditions: ["error"] },
    ]);
  }),
);

it.effect("validates every requested thread before returning a current condition", () =>
  Effect.gen(function* () {
    const missingThreadId = ThreadId.make("thread-wait-missing");
    const harness = makeWaitLayer({
      latestSequence: () => 25,
      stream: Stream.never,
      readShell: (threadId) =>
        Effect.succeed(
          threadId === waitThreadId ? Option.some(completedWaitThread()) : Option.none(),
        ),
    });
    const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
    const result = yield* service
      .threadsWait(
        invocation,
        waitInput({ threadIds: [waitThreadId, missingThreadId], afterSequence: 25 }),
      )
      .pipe(Effect.flip);

    expect(result).toMatchObject({
      code: "thread_not_found",
      operation: "threads_wait",
      targetThreadId: missingThreadId,
    });
  }),
);

it.effect("does not rematch an unchanged terminal thread on cursor renewal", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initialRead = yield* Deferred.make<void>();
      const shells = new Map<ThreadId, OrchestrationThreadShell>([
        [waitThreadId, completedWaitThread()],
        [secondWaitThreadId, thread(String(secondWaitThreadId))],
      ]);
      const harness = makeWaitLayer({
        latestSequence: () => 30,
        stream: Stream.never,
        readShell: (threadId) =>
          Deferred.succeed(initialRead, undefined).pipe(
            Effect.as(Option.fromNullishOr(shells.get(threadId))),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(
          invocation,
          waitInput({
            threadIds: [waitThreadId, secondWaitThreadId],
            afterSequence: 30,
            timeoutMs: 1_000,
          }),
        )
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust("1 second");
      expect(yield* Fiber.join(waiting)).toMatchObject({
        reason: "timeout",
        cursor: 30,
        matched: [],
      });
    }),
  ),
);

it.effect("catches up past unrelated events and still waits for a watched transition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      let head = 31;
      let current = thread(String(waitThreadId));
      const harness = makeWaitLayer({
        latestSequence: () => head,
        stream: Stream.fromQueue(events),
        replayEvents: [sessionEvent(31, "running", secondWaitThreadId)],
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(Effect.as(Option.some(current))),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 30 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();
      expect(harness.readEvents).toHaveBeenCalledWith(30, 1);

      current = completedWaitThread();
      head = 32;
      yield* Queue.offer(events, sessionEvent(32));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("50 millis");
      expect(yield* Fiber.join(waiting)).toMatchObject({
        reason: "condition",
        cursor: 32,
        resynchronized: false,
        matched: [{ threadId: waitThreadId, conditions: ["completed"] }],
      });
    }),
  ),
);

it.effect("returns only newly changed terminal threads during cursor catch-up", () =>
  Effect.gen(function* () {
    const shells = new Map<ThreadId, OrchestrationThreadShell>([
      [waitThreadId, completedWaitThread()],
      [secondWaitThreadId, { ...completedWaitThread(), id: secondWaitThreadId }],
    ]);
    const harness = makeWaitLayer({
      latestSequence: () => 41,
      stream: Stream.never,
      replayEvents: [sessionEvent(41, "ready", secondWaitThreadId)],
      readShell: (threadId) => Effect.succeed(Option.fromNullishOr(shells.get(threadId))),
    });
    const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
    const result = yield* service.threadsWait(
      invocation,
      waitInput({
        threadIds: [waitThreadId, secondWaitThreadId],
        afterSequence: 40,
      }),
    );

    expect(result).toMatchObject({
      reason: "condition",
      cursor: 41,
      resynchronized: false,
      matched: [{ threadId: secondWaitThreadId, conditions: ["completed"] }],
    });
  }),
);

it.effect("resynchronizes cursors that are ahead or too far behind without replaying", () =>
  Effect.gen(function* () {
    const harness = makeWaitLayer({
      latestSequence: () => 1_001,
      stream: Stream.never,
      readShell: () => Effect.succeed(Option.some(thread(String(waitThreadId)))),
    });
    const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));

    const stale = yield* service.threadsWait(invocation, waitInput({ afterSequence: 0 }));
    const ahead = yield* service.threadsWait(invocation, waitInput({ afterSequence: 1_002 }));

    expect(stale).toMatchObject({
      reason: "resynchronized",
      cursor: 1_001,
      resynchronized: true,
    });
    expect(ahead).toMatchObject({
      reason: "resynchronized",
      cursor: 1_001,
      resynchronized: true,
    });
    expect(harness.readEvents).not.toHaveBeenCalled();
  }),
);

it.effect("returns a bounded timeout through TestClock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initialRead = yield* Deferred.make<void>();
      const harness = makeWaitLayer({
        latestSequence: () => 40,
        stream: Stream.never,
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(
            Effect.as(Option.some(thread(String(waitThreadId)))),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 40, timeoutMs: 1_000 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 second");
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({ reason: "timeout", cursor: 40, resynchronized: false });
      expect(result.threads[0]?.cursor).toBe(40);
    }),
  ),
);

it.effect("counts status setup toward the timeout without refetching after expiry", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initialReadStarted = yield* Deferred.make<void>();
      let reads = 0;
      const harness = makeWaitLayer({
        latestSequence: () => 45,
        stream: Stream.never,
        readShell: () =>
          Effect.sync(() => {
            reads += 1;
            return reads;
          }).pipe(
            Effect.tap(() => Deferred.succeed(initialReadStarted, undefined)),
            Effect.flatMap((read) =>
              read === 1
                ? Effect.sleep("400 millis").pipe(
                    Effect.as(Option.some(thread(String(waitThreadId)))),
                  )
                : Effect.never,
            ),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 45, timeoutMs: 1_000 }))
        .pipe(Effect.forkScoped);

      yield* Deferred.await(initialReadStarted);
      yield* TestClock.adjust("400 millis");
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust("600 millis");
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeDefined();

      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({ reason: "timeout", cursor: 45, resynchronized: false });
      expect(result.threads[0]?.cursor).toBe(45);
      expect(reads).toBe(1);
    }),
  ),
);

it.effect("bounds an initial status read that never completes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initialReadStarted = yield* Deferred.make<void>();
      const harness = makeWaitLayer({
        latestSequence: () => 46,
        stream: Stream.never,
        readShell: () =>
          Deferred.succeed(initialReadStarted, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 46, timeoutMs: 1_000 }))
        .pipe(Effect.flip, Effect.forkScoped);

      yield* Deferred.await(initialReadStarted);
      yield* TestClock.adjust("1 second");
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({
        code: "read_failed",
        operation: "threads_wait",
        retryable: true,
      });
    }),
  ),
);

it.effect("ignores assistant token and context-window noise even in progress mode", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      const harness = makeWaitLayer({
        latestSequence: () => 50,
        stream: Stream.fromQueue(events),
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(
            Effect.as(Option.some(thread(String(waitThreadId)))),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 50, timeoutMs: 1_000, progress: true }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      yield* Queue.offerAll(events, [
        assistantMessageEvent(51),
        activityEvent(52, "context-window.updated", "Context window updated"),
      ]);
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({ reason: "timeout", cursor: 50, progress: [] });
      expect(result.threads[0]?.cursor).toBe(50);
      expect(harness.getThreadDetailById).not.toHaveBeenCalled();
      expect(harness.getThreadDetailSnapshot).not.toHaveBeenCalled();
      expect(harness.readEvents).not.toHaveBeenCalled();
    }),
  ),
);

it.effect("a token flood does not refetch or wake and a meaningful signal still does", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      let current = thread(String(waitThreadId));
      let reads = 0;
      const meaningfulSequence = 2_051;
      const harness = makeWaitLayer({
        latestSequence: () => 50,
        stream: Stream.fromQueue(events),
        readShell: () =>
          Effect.sync(() => {
            reads += 1;
            return Option.some(current);
          }).pipe(Effect.tap(() => Deferred.succeed(initialRead, undefined))),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 50, progress: true }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);

      yield* Queue.offerAll(
        events,
        Array.from({ length: 2_000 }, (_, index) => assistantMessageEvent(51 + index)),
      );
      yield* Effect.yieldNow;
      expect(waiting.pollUnsafe()).toBeUndefined();
      expect(reads).toBe(1);

      current = completedWaitThread();
      yield* Queue.offer(
        events,
        activityEvent(meaningfulSequence, "task.completed", "Reviewer completed"),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");
      yield* Effect.yieldNow;
      yield* TestClock.adjust("100 millis");

      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({
        reason: "condition",
        cursor: meaningfulSequence,
        matched: [{ threadId: waitThreadId, conditions: ["completed"] }],
      });
      expect(reads).toBe(2);
    }),
  ),
);

it.effect("does not publish an event cursor when its status refetch times out", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      const refetchStarted = yield* Deferred.make<void>();
      let head = 90;
      let current: OrchestrationThreadShell = {
        ...completedWaitThread(),
        backgroundLiveness: "working",
      };
      let reads = 0;
      const harness = makeWaitLayer({
        latestSequence: () => head,
        stream: Stream.fromQueue(events),
        replayEvents: [activityEvent(91, "task.completed", "Reviewer completed")],
        readShell: () => {
          reads += 1;
          if (reads === 1) {
            return Deferred.succeed(initialRead, undefined).pipe(Effect.as(Option.some(current)));
          }
          if (reads === 2) {
            return Deferred.succeed(refetchStarted, undefined).pipe(Effect.andThen(Effect.never));
          }
          return Effect.succeed(Option.some(current));
        },
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 90, timeoutMs: 1_000 }))
        .pipe(Effect.forkScoped);

      yield* Deferred.await(initialRead);
      current = { ...current, backgroundLiveness: null };
      head = 91;
      yield* Queue.offer(events, activityEvent(91, "task.completed", "Reviewer completed"));
      yield* TestClock.adjust("50 millis");
      yield* Deferred.await(refetchStarted);
      yield* TestClock.adjust("950 millis");

      const timedOut = yield* Fiber.join(waiting);
      expect(timedOut).toMatchObject({
        reason: "timeout",
        cursor: 90,
        threads: [
          {
            threadId: waitThreadId,
            status: "running",
            backgroundLiveness: "working",
            cursor: 90,
          },
        ],
      });

      const caughtUp = yield* service.threadsWait(
        invocation,
        waitInput({ afterSequence: timedOut.cursor, wakeOn: [], progress: true }),
      );
      expect(caughtUp).toMatchObject({
        reason: "progress",
        resynchronized: false,
        cursor: 91,
        threads: [
          {
            threadId: waitThreadId,
            status: "completed",
            backgroundLiveness: null,
            cursor: 91,
          },
        ],
        matched: [],
      });
    }),
  ),
);

it.effect("returns only bounded payload-free summaries for meaningful progress", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      const harness = makeWaitLayer({
        latestSequence: () => 60,
        stream: Stream.fromQueue(events),
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(
            Effect.as(Option.some(thread(String(waitThreadId)))),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 60, progress: true }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      const longKind = `tool.${"k".repeat(200)}`;
      const longSummary = "s".repeat(1_000);
      yield* Queue.offerAll(events, [
        activityEvent(61, "context-compaction", "Compacting context"),
        activityEvent(62, longKind, longSummary, "tool"),
      ]);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("50 millis");
      const result = yield* Fiber.join(waiting);
      expect(result.reason).toBe("progress");
      expect(result.cursor).toBe(62);
      expect(result.progress).toEqual([
        {
          sequence: 62,
          threadId: waitThreadId,
          kind: `${longKind.slice(0, 127)}…`,
          tone: "tool",
          summary: `${longSummary.slice(0, 511)}…`,
          timestamp: base,
        },
      ]);
      expect(Object.keys(result.progress[0]!).toSorted()).toEqual(
        ["kind", "sequence", "summary", "threadId", "timestamp", "tone"].toSorted(),
      );
      expect(result.progress[0]).not.toHaveProperty("payload");
    }),
  ),
);

it.effect("coalesces scheduler-separated event bursts before refetching statuses", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      let current = thread(String(waitThreadId));
      let reads = 0;
      const harness = makeWaitLayer({
        latestSequence: () => 65,
        stream: Stream.fromQueue(events),
        readShell: () =>
          Effect.sync(() => {
            reads += 1;
            return Option.some(current);
          }).pipe(Effect.tap(() => Deferred.succeed(initialRead, undefined))),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 65 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      yield* Effect.yieldNow;

      yield* Queue.offer(events, sessionEvent(66, "running"));
      yield* Effect.yieldNow;
      expect(reads).toBe(1);

      yield* TestClock.adjust("10 millis");
      yield* Queue.offer(events, activityEvent(67, "tool.started", "Running tests", "tool"));
      yield* Effect.yieldNow;
      expect(reads).toBe(1);

      yield* TestClock.adjust("10 millis");
      current = completedWaitThread();
      yield* Queue.offer(events, sessionEvent(68));
      yield* Effect.yieldNow;
      expect(reads).toBe(1);

      yield* TestClock.adjust("30 millis");
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({
        reason: "condition",
        cursor: 68,
        matched: [{ threadId: waitThreadId, conditions: ["completed"] }],
      });
      expect(reads).toBe(2);
    }),
  ),
);

it.effect("wakes for background idle only after observing live background work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<OrchestrationEvent>();
      const initialRead = yield* Deferred.make<void>();
      let current: OrchestrationThreadShell = {
        ...completedWaitThread(),
        backgroundLiveness: "working",
      };
      const harness = makeWaitLayer({
        latestSequence: () => 70,
        stream: Stream.fromQueue(events),
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(Effect.as(Option.some(current))),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 70 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(initialRead);
      current = { ...current, backgroundLiveness: null };
      yield* Queue.offer(events, activityEvent(71, "task.completed", "Reviewer completed"));
      yield* Effect.yieldNow;
      yield* TestClock.adjust("50 millis");
      const result = yield* Fiber.join(waiting);
      expect(result).toMatchObject({
        reason: "condition",
        cursor: 71,
        matched: [{ threadId: waitThreadId, conditions: ["completed", "background_idle"] }],
      });
    }),
  ),
);

it.effect("cancellation closes the scoped live subscription", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const attached = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      const initialRead = yield* Deferred.make<void>();
      const stream = Stream.unwrap(
        Deferred.succeed(attached, undefined).pipe(Effect.as(Stream.never)),
      ).pipe(Stream.ensuring(Deferred.succeed(closed, undefined)));
      const harness = makeWaitLayer({
        latestSequence: () => 80,
        stream,
        readShell: () =>
          Deferred.succeed(initialRead, undefined).pipe(
            Effect.as(Option.some(thread(String(waitThreadId)))),
          ),
      });
      const service = yield* ThreadControlService.pipe(Effect.provide(harness.testLayer));
      const waiting = yield* service
        .threadsWait(invocation, waitInput({ afterSequence: 80 }))
        .pipe(Effect.forkScoped);
      yield* Deferred.await(attached);
      yield* Deferred.await(initialRead);
      yield* Fiber.interrupt(waiting);
      yield* Deferred.await(closed);
      expect(harness.getThreadDetailById).not.toHaveBeenCalled();
      expect(harness.getThreadDetailSnapshot).not.toHaveBeenCalled();
    }),
  ),
);
