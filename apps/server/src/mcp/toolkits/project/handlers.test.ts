import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ThreadLaunch from "../../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerConfig from "../../../config.ts";
import * as Project from "../../../project/ProjectService.ts";
import * as ManagedProjectFolders from "../../../project/ManagedProjectFolders.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ProjectHandlersLive } from "./handlers.ts";
import { ProjectToolkit } from "./tools.ts";

/** Caller modes, requested overrides, and expected permission failures for launches. */
type LaunchPermissionCase = readonly [
  callerRuntimeMode: RuntimeMode,
  callerInteractionMode: ProviderInteractionMode,
  requestedRuntimeMode: RuntimeMode | undefined,
  requestedInteractionMode: ProviderInteractionMode | undefined,
  expectedFailureCode: string | undefined,
];

it.effect.each([
  ["approval-required", "default", undefined, undefined, undefined],
  ["auto-accept-edits", "default", undefined, undefined, undefined],
  ["auto", "default", undefined, undefined, undefined],
  ["full-access", "default", undefined, undefined, undefined],
  ["approval-required", "plan", undefined, undefined, undefined],
  ["auto-accept-edits", "plan", undefined, undefined, undefined],
  ["auto", "plan", undefined, undefined, undefined],
  ["full-access", "plan", undefined, undefined, undefined],
  ["auto", "default", "auto", "default", undefined],
  ["auto", "default", "approval-required", "plan", undefined],
  ["full-access", "default", "auto", "default", undefined],
  [
    "approval-required",
    "default",
    "auto-accept-edits",
    undefined,
    "runtime_mode_escalation_denied",
  ],
  ["auto-accept-edits", "default", "auto", undefined, "runtime_mode_escalation_denied"],
  ["auto", "default", "full-access", undefined, "runtime_mode_escalation_denied"],
  ["auto", "plan", undefined, "default", "interaction_mode_escalation_denied"],
  ["full-access", "plan", undefined, "default", "interaction_mode_escalation_denied"],
] satisfies ReadonlyArray<LaunchPermissionCase>)(
  "launch permissions for caller %s/%s and requested %s/%s, failure %s",
  ([
    callerRuntimeMode,
    callerInteractionMode,
    requestedRuntimeMode,
    requestedInteractionMode,
    expectedFailureCode,
  ]) =>
    Effect.gen(function* () {
      const sourceThreadId = ThreadId.make("source-thread");
      const projectId = ProjectId.make("project");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const modelSelection = { instanceId: providerInstanceId, model: "gpt-5" };
      const caller = {
        id: sourceThreadId,
        projectId,
        providerInstanceId,
        modelSelection,
        runtimeMode: callerRuntimeMode,
        interactionMode: callerInteractionMode,
        activeRunId: "active-run",
        archivedAt: null,
        deletedAt: null,
      } as OrchestrationV2ThreadShell;
      const launchRequests: Array<ThreadLaunch.ThreadLaunchInput> = [];
      const dependencies = Layer.mergeAll(
        NodeCrypto.layer,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          threadId: sourceThreadId,
          providerSessionId: "session",
          providerInstanceId,
          issuedAt: 0,
          capabilities: new Set(["orchestration" as const]),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(caller),
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (input) => {
            launchRequests.push(input);
            return Effect.succeed({
              threadId: input.threadId,
              projection: {
                thread: { id: input.threadId, projectId, modelSelection },
                runs: [],
              },
              resumed: false,
            } as unknown as ThreadLaunch.ThreadLaunchResult);
          },
        }),
        Layer.mock(Project.ProjectService)({}),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({ namedProjectsRoot: "/projects" }),
        NodeServices.layer,
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-source-link-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
      );
      const toolkit = yield* ProjectToolkit.pipe(
        Effect.provide(ProjectHandlersLive.pipe(Layer.provide(dependencies))),
      );
      const result = yield* toolkit
        .handle("t3_thread_launch", {
          title: "Audit",
          message: "Review the change",
          runtimeMode: requestedRuntimeMode,
          interactionMode: requestedInteractionMode,
          workspaceStrategy: { type: "existing_worktree", worktreePath: "/work/review" },
        })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      if (expectedFailureCode !== undefined) {
        expect(result.at(-1)?.result).toMatchObject({ code: expectedFailureCode });
        expect(launchRequests).toHaveLength(0);
        return;
      }
      expect(result.at(-1)?.result).toMatchObject({ projectId, modelSelection });
      expect(launchRequests).toHaveLength(1);
      expect(launchRequests[0]).toMatchObject({
        runtimeMode: requestedRuntimeMode ?? callerRuntimeMode,
        interactionMode: requestedInteractionMode ?? callerInteractionMode,
        workspaceStrategy: { type: "existing_worktree", worktreePath: "/work/review" },
        initialMessage: { senderThreadId: sourceThreadId },
      });
    }),
);

it.effect("launches a scratch thread into the Scratch project", () =>
  Effect.gen(function* () {
    const sourceThreadId = ThreadId.make("source-thread");
    const scratchProjectId = ProjectId.make("project:scratch");
    const providerInstanceId = ProviderInstanceId.make("codex");
    const modelSelection = { instanceId: providerInstanceId, model: "gpt-5" };
    const caller = {
      id: sourceThreadId,
      projectId: ProjectId.make("project:caller"),
      providerInstanceId,
      modelSelection,
      runtimeMode: "auto",
      interactionMode: "default",
      activeRunId: "active-run",
      archivedAt: null,
      deletedAt: null,
    } as OrchestrationV2ThreadShell;
    const launched: Array<ThreadLaunch.ThreadLaunchInput> = [];
    let scratchProvisionCount = 0;
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        threadId: sourceThreadId,
        providerSessionId: "session",
        providerInstanceId,
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(caller),
      }),
      Layer.mock(ThreadLaunch.ThreadLaunchService)({
        launch: (input) => {
          launched.push(input);
          return Effect.succeed({
            threadId: input.threadId,
            projection: {
              thread: { id: input.threadId, projectId: input.projectId, modelSelection },
              runs: [],
            },
            resumed: false,
          } as unknown as ThreadLaunch.ThreadLaunchResult);
        },
      }),
      Layer.mock(Project.ProjectService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        ensureScratchProject: Effect.sync(() => {
          scratchProvisionCount += 1;
          return { projectId: scratchProjectId };
        }),
      }),
      NodeServices.layer,
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-scratch-launch-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    );
    const toolkit = yield* ProjectToolkit.pipe(
      Effect.provide(ProjectHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const handle = (params: Parameters<typeof toolkit.handle<"t3_thread_launch">>[1]) =>
      toolkit
        .handle("t3_thread_launch", params)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));

    const result = yield* handle({ title: "Notes", scratch: true, message: "Draft a list" });
    expect(result.at(-1)?.result).toMatchObject({ projectId: scratchProjectId });
    expect(launched.map((input) => [input.projectId, input.workspaceStrategy])).toEqual([
      [scratchProjectId, { type: "root" }],
    ]);

    const rejected = yield* handle({
      title: "Notes",
      scratch: true,
      projectId: caller.projectId,
    });
    expect(rejected.at(-1)?.result).toMatchObject({ code: "invalid_request" });
    expect(launched).toHaveLength(1);

    const escalation = yield* handle({
      title: "Notes",
      scratch: true,
      runtimeMode: "full-access",
    });
    expect(escalation.at(-1)?.result).toMatchObject({ code: "runtime_mode_escalation_denied" });
    expect(launched).toHaveLength(1);
    expect(scratchProvisionCount).toBe(1);
  }),
);

it.effect("starts a project from just a title when workspaceRoot is omitted", () =>
  Effect.gen(function* () {
    const sourceThreadId = ThreadId.make("source-thread");
    const createdProjectId = ProjectId.make("project:named");
    const providerInstanceId = ProviderInstanceId.make("codex");
    const caller = {
      id: sourceThreadId,
      projectId: ProjectId.make("project:caller"),
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      activeRunId: "active-run",
      archivedAt: null,
      deletedAt: null,
    } as OrchestrationV2ThreadShell;
    const named: Array<string> = [];
    const registered: Array<string> = [];
    const createdProject = {
      id: createdProjectId,
      title: "Pinball Stats",
      workspaceRoot: "/projects/pinball-stats",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
    };
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment"),
        threadId: sourceThreadId,
        providerSessionId: "session",
        providerInstanceId,
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(caller),
      }),
      Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
      Layer.mock(Project.ProjectService)({
        create: (input) =>
          Effect.sync(() => {
            registered.push(input.workspaceRoot);
            return { ...createdProject, id: input.projectId, workspaceRoot: input.workspaceRoot };
          }),
        getById: (projectId) =>
          Effect.succeed(
            projectId === createdProjectId ? Option.some(createdProject) : Option.none(),
          ),
      }),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        createNamedProject: (input) =>
          Effect.sync(() => {
            named.push(input.name);
            return {
              projectId: createdProjectId,
              workspaceRoot: createdProject.workspaceRoot,
              commitError: "Git has no name or email on this machine.",
            };
          }),
      }),
      NodeServices.layer,
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-named-project-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    );
    const toolkit = yield* ProjectToolkit.pipe(
      Effect.provide(ProjectHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const handle = (params: Parameters<typeof toolkit.handle<"t3_project_create">>[1]) =>
      toolkit
        .handle("t3_project_create", params)
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));

    const result = yield* handle({ title: "Pinball Stats" });
    expect(result.at(-1)?.result).toMatchObject({
      id: createdProjectId,
      workspaceRoot: "/projects/pinball-stats",
      commitError: "Git has no name or email on this machine.",
    });
    expect(named).toEqual(["Pinball Stats"]);

    // A path still registers that folder, and never makes a named project.
    yield* handle({ title: "Existing", workspaceRoot: "/work/existing" });
    expect(registered).toEqual(["/work/existing"]);

    // Fields this mode cannot apply are rejected, not dropped.
    for (const extra of [
      { scripts: [] },
      { defaultModelSelection: { instanceId: providerInstanceId, model: "gpt-5" } },
    ]) {
      const rejected = yield* handle({ title: "Configured", ...extra });
      expect(rejected.at(-1)?.result).toMatchObject({ code: "invalid_request" });
    }
    expect(named).toEqual(["Pinball Stats"]);
  }),
);
