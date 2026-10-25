import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode, ScopedThreadRef } from "@t3tools/contracts";
import type { ThreadRouteTarget } from "../threadRoutes";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let routeTarget: ThreadRouteTarget | null = null;
  let projectRemoved = false;
  let sourceThread: {
    environmentId: string;
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
  } | null = null;
  let connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
    readonly sourceThreadRef?: ScopedThreadRef | null;
    readonly projectId?: string;
    readonly branch?: string | null;
    readonly worktreePath?: string | null;
    readonly envMode?: "local" | "worktree";
    readonly startFromOrigin?: boolean;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => storedDraft),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    /** Keep draft context so tests observe source references after creation and reuse. */
    setLogicalProjectDraftThreadId: vi.fn(
      (
        _logicalProjectKey: string,
        projectRef: { environmentId: string },
        draftId: string,
        draftContext: { threadId: string; sourceThreadRef?: ScopedThreadRef | null },
      ) => {
        storedDraft = {
          ...storedDraft,
          draftId,
          environmentId: projectRef.environmentId,
          promotedTo: null,
          ...draftContext,
        };
      },
    ),
    setModelSelection: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    get connectedEnvironmentIds() {
      return connectedEnvironmentIds;
    },
    disconnect(environmentId: string) {
      connectedEnvironmentIds = connectedEnvironmentIds.filter((id) => id !== environmentId);
    },
    removeProject() {
      projectRemoved = true;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree" | null,
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      routeTarget = null;
      projectRemoved = false;
      sourceThread = null;
      connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
    set routeTarget(nextRouteTarget: ThreadRouteTarget | null) {
      routeTarget = nextRouteTarget;
    },
    get routeTarget() {
      return routeTarget;
    },
    get storedDraft() {
      return storedDraft;
    },
    get sourceThread() {
      return sourceThread;
    },
    set sourceThread(nextSourceThread: typeof sourceThread) {
      sourceThread = nextSourceThread;
    },
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "connected-environment-ids"
        ? testState.connectedEnvironmentIds
        : testServerConfigs(),
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", () => ({
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: (threadRef: { threadId: string }) =>
      threadRef.threadId === "source-thread" ? testState.sourceThread : null,
    readThreadShells: () => [],
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/olderSettledShelf", () => ({ readUnloadedThreadCount: () => 0 }));
vi.mock("../state/presentation", () => ({
  environmentSummaries: { connectedEnvironmentIdsAtom: "connected-environment-ids" },
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => testState.routeTarget }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each([
    { branch: "feature", worktreePath: "/remote/worktrees/feature", envMode: "worktree" },
    { branch: "main", worktreePath: null, envMode: "local" },
    { branch: null, worktreePath: "/remote/worktrees/detached", envMode: "worktree" },
  ] as const)(
    "continues the current workspace $worktreePath above project defaults",
    async (workspace) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: true });
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      };
      testState.sourceThread = {
        ...projectRef,
        branch: workspace.branch,
        worktreePath: workspace.worktreePath,
      };
      testState.routeTarget = {
        kind: "server",
        threadRef: { environmentId: projectRef.environmentId, threadId: "source-thread" },
      } as ThreadRouteTarget;

      const opened = await useNewThreadHandler()(projectRef as never, { continueWorkspace: true });

      expect(testState.storedDraft).toMatchObject({
        ...workspace,
        startFromOrigin: false,
        sourceThreadRef: null,
      });
      expect(testState.router.state.location.href).toBe(`/draft/${opened!.draftId}`);
    },
  );

  it("uses project defaults when continuing without a source thread", async () => {
    testState.reset(draft, { envMode: "worktree", startFromOrigin: true });
    const pendingOpen = useNewThreadHandler()(
      {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never,
      { continueWorkspace: true },
    );
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.storedDraft).toMatchObject({
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
    });
  });

  it("does not use the viewed thread as the source for interactive creation", async () => {
    testState.reset(draft);
    testState.sourceThread = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
      branch: "feature",
      worktreePath: "/remote/worktrees/feature",
    };
    testState.routeTarget = {
      kind: "server",
      threadRef: { environmentId: "environment-ssh", threadId: "source-thread" },
    } as ThreadRouteTarget;
    const projectRef = {
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never;

    const pendingOpen = useNewThreadHandler()(projectRef);
    testState.completeProjectFileRead(null);
    const opened = await pendingOpen;

    expect(testState.storedDraft?.draftId).toBe(opened!.draftId);
    expect(testState.storedDraft?.sourceThreadRef).toBeNull();
    expect(testState.storedDraft).toMatchObject({
      branch: null,
      worktreePath: null,
      envMode: "local",
    });
  });

  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });
});

describe("useNewThreadHandler", () => {
  it("opens the draft without waiting on a project file from an offline machine", async () => {
    testState.reset(null, { envMode: null, startFromOrigin: false });
    testState.disconnect("environment-ssh");

    const opened = await useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    expect(opened).toEqual({ draftId: "draft-delayed", threadId: "thread-delayed" });
    expect(testState.router.navigate).toHaveBeenCalledOnce();
  });
});

it.each([
  { branch: "main", worktreePath: null, envMode: "local", startFromOrigin: false },
  {
    branch: "feature",
    worktreePath: "/remote/worktrees/feature",
    envMode: "worktree",
    startFromOrigin: false,
  },
  { branch: "base", worktreePath: null, envMode: "worktree", startFromOrigin: true },
] as const)("continues an open draft's $envMode workspace choice", async (workspace) => {
  const sourceDraft = {
    draftId: "draft-source",
    threadId: "thread-source",
    environmentId: "environment-ssh",
    projectId: "project-remote",
    promotedTo: null,
    ...workspace,
  };
  testState.reset(sourceDraft);
  testState.routeTarget = { kind: "draft", draftId: sourceDraft.draftId } as ThreadRouteTarget;
  testState.router.state.location.href = `/draft/${sourceDraft.draftId}`;

  await useNewThreadHandler()(
    { environmentId: sourceDraft.environmentId, projectId: sourceDraft.projectId } as never,
    { continueWorkspace: true },
  );

  expect(testState.storedDraft).toMatchObject(workspace);
  expect(testState.router.navigate).not.toHaveBeenCalled();
});

it("clears a persisted source when the empty draft is already open", async () => {
  const draft = {
    draftId: "draft-existing",
    environmentId: "environment-ssh",
    promotedTo: null,
    threadId: "thread-existing",
    sourceThreadRef: {
      environmentId: "environment-ssh",
      threadId: "tagged-parent",
    } as ScopedThreadRef,
  } as const;
  testState.reset(draft);
  testState.routeTarget = { kind: "draft", draftId: draft.draftId } as ThreadRouteTarget;

  await useNewThreadHandler()({
    environmentId: "environment-ssh",
    projectId: "project-remote",
  } as never);

  expect(testState.storedDraft?.draftId).toBe(draft.draftId);
  expect(testState.storedDraft?.sourceThreadRef).toBeNull();
});
