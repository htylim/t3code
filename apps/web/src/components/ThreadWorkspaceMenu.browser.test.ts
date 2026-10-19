import { createElement, act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";

const state = vi.hoisted(() => ({
  picker: null as WorkspaceMenuProps | null,
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
  create: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../state/entities", () => ({
  useQuietThreadShell: () => state.thread,
  readThreadShell: () => state.thread,
  useProject: () => ({ id: "project", workspaceRoot: "/repo" }),
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => state.canOperate,
  readEnvironmentScope: () => state.canOperate,
}));
vi.mock("../composerDraftStore", () => ({
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
vi.mock("./WorkspaceMenu", () => ({
  /** Expose committed controller state while the real picker has its own browser tests. */
  WorkspaceMenu: function WorkspaceMenuFixture(props: WorkspaceMenuProps) {
    useLayoutEffect(() => {
      state.picker = props;
    });
    return null;
  },
}));

import { ThreadWorkspaceMenu } from "./ThreadWorkspaceMenu";
import type { WorkspaceMenuProps } from "./WorkspaceMenu";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";

const threadRef = {
  environmentId: EnvironmentId.make("remote"),
  threadId: ThreadId.make("thread"),
};
const projectRef = { environmentId: threadRef.environmentId, projectId: ProjectId.make("project") };
let root: Root;
let container: HTMLDivElement;

/** Render the controller while leaving presentation to the existing picker component. */
async function openPicker(): Promise<WorkspaceMenuProps> {
  await act(async () => {
    root.render(createElement(ThreadWorkspaceMenu, { threadRef }));
  });
  return pickerProps();
}

/** Read the latest error and availability after an asynchronous workspace operation. */
function pickerProps(): WorkspaceMenuProps {
  return state.picker!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.picker = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.thread.branch = "feature/source";
  state.thread.worktreePath = "/trees/current";
  state.thread.runtime = null;
  state.thread.hasPendingApprovals = false;
  state.thread.hasPendingUserInput = false;
  state.canOperate = true;
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("moves only the selected thread and adopts the destination's current branch", async () => {
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
  const picker = await openPicker();
  await act(async () => {
    await picker.onUseWorktree({ branch: "main", worktreePath: "/repo" });
  });
  expect(state.update.mock.calls[0]![0].input.worktreePath).toBeNull();
});

it("creates the same-named branch from the original thread branch and saves its color", async () => {
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
  state.refresh.mockResolvedValue(AsyncResult.success({ isRepo: true, refName: null }));
  const picker = await openPicker();
  await act(async () => {
    await picker.onUseWorktree({ branch: "stale", worktreePath: "/trees/target" });
  });
  expect(state.update.mock.calls[0]![0].input.branch).toBeNull();
});

it("does not create two worktrees when the creation row is selected twice", async () => {
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
  const picker = await openPicker();
  state.canOperate = false;
  await act(async () => {
    expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(false);
  });
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps an unavailable destination from changing the thread", async () => {
  state.refresh.mockResolvedValue(AsyncResult.success({ isRepo: false }));
  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onUseWorktree({ branch: "old", worktreePath: "/missing" })).toBe(false);
  });
  expect(state.update).not.toHaveBeenCalled();
  expect(pickerProps().selectionHint).toContain("unavailable");
});

it("keeps a newly created checkout available for retry if the thread changes before assignment", async () => {
  state.update.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Workspace changed"))));
  const picker = await openPicker();
  await act(async () => {
    expect(await picker.onNewWorktreeSelect({ name: "billing-fix", color: "#14b8a6" })).toBe(false);
  });
  expect(pickerProps().selectionHint).toContain("Select it from the worktree list to retry");
  expect(state.create).toHaveBeenCalledTimes(1);
});
