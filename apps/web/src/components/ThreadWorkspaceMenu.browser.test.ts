import { act, render as renderScreen } from "../../test/render";
import { createElement, useLayoutEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";

const state = vi.hoisted(() => ({
  picker: null as WorkspaceChangeDialogProps | null,
  thread: {
    environmentId: "remote",
    id: "thread",
    projectId: "project",
    branch: "feature/source",
    worktreePath: "/trees/current" as string | null,
    runtime: null as { status: string } | null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  },
  canOperate: true,
  threadAvailable: true,
  create: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../state/entities", () => ({
  useQuietThreadShell: () => state.thread,
  readThreadShell: () => (state.threadAvailable ? state.thread : null),
  useProject: () => ({ id: "project", workspaceRoot: "/repo" }),
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => state.canOperate,
  readEnvironmentScope: () => state.canOperate,
}));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (draftId: string) => draftId },
  useComposerDraftStore: (select: (store: { getDraftThreadByRef: () => null }) => unknown) =>
    select({ getDraftThreadByRef: () => null }),
}));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: {
    createWorktree: { kind: "create", permissionAtom: () => null },
    refreshStatus: { kind: "refresh" },
  },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { kind: "create" | "refresh" }) => state[command.kind],
}));
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.update,
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("./WorkspaceChangeDialog", () => ({
  /** Expose committed controller state while the real picker has its own browser tests. */
  WorkspaceChangeDialog: function WorkspaceChangeDialogFixture(props: WorkspaceChangeDialogProps) {
    useLayoutEffect(() => {
      state.picker = props;
    });
    return null;
  },
}));

import { ThreadWorkspaceMenu } from "./ThreadWorkspaceMenu";
import type { WorkspaceChangeDialogProps } from "./WorkspaceChangeDialog";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";

const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
};
const projectRef = { environmentId: threadRef.environmentId, projectId: ProjectId.make("project") };

/** Read the latest error and availability after an asynchronous workspace operation. */
function pickerProps(): WorkspaceChangeDialogProps {
  return state.picker!;
}

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  state.picker = null;
  const container = document.createElement("div");
  document.body.append(container);
  const screen = await renderScreen(null, { container });
  state.thread.branch = "feature/source";
  state.thread.worktreePath = "/trees/current";
  state.thread.runtime = null;
  state.thread.hasPendingApprovals = false;
  state.thread.hasPendingUserInput = false;
  state.canOperate = true;
  state.threadAvailable = true;
  state.refresh
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ isRepo: true, refName: "actual-target" }));
  state.create
    .mockReset()
    .mockResolvedValue(
      AsyncResult.success({ worktree: { path: "/trees/billing-fix", refName: "billing-fix" } }),
    );
  state.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  useNamedWorktreeStore.setState({ selections: {}, worktrees: {} });

  async function openPicker(): Promise<WorkspaceChangeDialogProps> {
    await act(async () => {
      screen.rerender(createElement(ThreadWorkspaceMenu, { threadRef, open: true }));
    });
    return pickerProps();
  }
  return {
    screen,
    container,
    openPicker,
    async [Symbol.asyncDispose]() {
      try {
        vi.unstubAllGlobals();
      } finally {
        await screen[Symbol.asyncDispose]();
      }
    },
  };
}

it("moves only the selected thread and adopts the destination's current branch", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onUseWorktree({ branch: "stale-ref", worktreePath: "/trees/target" })).toBe(
      true,
    );
  });
  expect(state.update.mock.calls).toEqual([
    [
      {
        environmentId: "remote",
        input: {
          threadId: "thread",
          branch: "actual-target",
          worktreePath: "/trees/target",
          expectedWorktreePath: "/trees/current",
          expectedBranch: "feature/source",
          expectedIdle: true,
        },
      },
    ],
  ]);
  expect(state.create).not.toHaveBeenCalled();
});

it("represents the project's local checkout with a null worktree path", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  const picker = await openPicker();
  await act(async () => {
    await picker.onUseWorktree({ branch: "main", worktreePath: "/repo" });
  });
  expect(state.update.mock.calls[0]![0].input.worktreePath).toBeNull();
});

it("creates the same-named branch from the original thread branch and saves its color", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(true);
  });
  expect(state.create).toHaveBeenCalledWith({
    environmentId: "remote",
    input: {
      cwd: "/repo",
      refName: "feature/source",
      baseRefName: "feature/source",
      newRefName: "billing-fix",
      directoryName: "billing-fix",
      path: null,
    },
  });
  expect(state.update.mock.calls[0]![0].input).toMatchObject({
    branch: "billing-fix",
    worktreePath: "/trees/billing-fix",
  });
  expect(
    useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, "/trees/billing-fix")]
      ?.color,
  ).toBe("#14b8a6");
});

it.each([null, { name: " ", color: "#14b8a6" }])(
  "rejects creation without an explicit worktree name: %j",
  async (selection) => {
    await using surface = await createTestSurface();
    const { openPicker } = surface;

    const picker = await openPicker();
    await act(async () => {
      expect(await picker.onNewWorktreeSelect(selection)).toBe(false);
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(pickerProps().selectionHint).toContain("Enter a worktree name");
  },
);

it("adopts a detached destination without inventing a branch", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  state.refresh.mockResolvedValue(AsyncResult.success({ isRepo: true, refName: null }));
  const picker = await openPicker();
  await act(async () => {
    await picker.onUseWorktree({ branch: "stale", worktreePath: "/trees/target" });
  });
  expect(state.update.mock.calls[0]![0].input.branch).toBeNull();
});

it("does not create two worktrees when the creation row is selected twice", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  const created = AsyncResult.success({
    worktree: { path: "/trees/billing-fix", refName: "billing-fix" },
  });
  let complete!: (result: typeof created) => void;
  state.create.mockReturnValue(
    new Promise<typeof created>((resolve) => {
      complete = resolve;
    }),
  );
  const picker = await openPicker();
  const selection = { name: "billing-fix", color: "#14b8a6" };
  await act(async () => {
    const first = picker.onNewWorktreeSelect(selection);
    expect(await picker.onNewWorktreeSelect(selection)).toBe(false);
    complete(created);
    expect(await first).toBe(true);
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.update).toHaveBeenCalledTimes(1);
});

it.each(["queued", "preparing", "starting", "running", "waiting"])(
  "does not move a thread that becomes %s after opening",
  async (status) => {
    await using surface = await createTestSurface();
    const { openPicker } = surface;

    const picker = await openPicker();
    state.thread.runtime = { status };
    await act(async () => {
      expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(
        false,
      );
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  },
);

it("rechecks thread permission before creating a checkout", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  const picker = await openPicker();
  state.canOperate = false;
  await act(async () => {
    expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(false);
  });
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps an unavailable destination from changing the thread", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  state.refresh.mockResolvedValue(AsyncResult.success({ isRepo: false }));
  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onUseWorktree({ branch: "old", worktreePath: "/missing" })).toBe(false);
  });
  expect(state.update).not.toHaveBeenCalled();
  expect(pickerProps().selectionHint).toContain("unavailable");
});

it("keeps a newly created checkout available for retry if the thread changes before assignment", async () => {
  await using surface = await createTestSurface();
  const { openPicker } = surface;

  state.update.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Workspace changed"))));
  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(false);
  });
  expect(pickerProps().selectionHint).toContain("Select it from the worktree list to retry");
  expect(state.create).toHaveBeenCalledTimes(1);
});

it.each(["busy", "permission", "workspace", "branch", "deleted"])(
  "rechecks %s after validating the destination before moving the thread",
  async (changedState) => {
    await using surface = await createTestSurface();
    const { openPicker } = surface;

    const ready = AsyncResult.success({ isRepo: true, refName: "actual-target" });
    let finishValidation!: (status: typeof ready) => void;
    state.refresh.mockReturnValue(
      new Promise<typeof ready>((resolve) => {
        finishValidation = resolve;
      }),
    );
    const picker = await openPicker();
    let change!: void | Promise<boolean>;
    await act(async () => {
      change = picker.onUseWorktree({ branch: "main", worktreePath: "/trees/target" });
    });
    if (changedState === "deleted") state.threadAvailable = false;
    if (changedState === "busy") state.thread.runtime = { status: "running" };
    if (changedState === "permission") state.canOperate = false;
    if (changedState === "workspace") state.thread.worktreePath = "/trees/elsewhere";
    if (changedState === "branch") state.thread.branch = "changed-branch";
    await act(async () => {
      finishValidation(ready);
      expect(await change).toBe(false);
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  },
);
