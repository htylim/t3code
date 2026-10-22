import "../index.css";
import { EnvironmentId, GitCommandError, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

type TestThread = {
  id: string;
  projectId: string;
  worktreePath: string;
  status: "completed" | "running";
};
const state = vi.hoisted(() => ({
  rename: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  refreshStatus: vi.fn(),
  parentContextMenu: vi.fn(),
  allowed: true,
  entries: ["/trees/alpha", "/trees/beta"],
  live: [] as TestThread[],
  archived: [] as TestThread[],
  draftStore: { draftThreadsByThreadKey: {}, setDraftThreadContext: vi.fn() },
}));
vi.mock("../state/entities", () => ({
  useThreadShellsForProjectRefs: () =>
    state.live.map((source) => ({
      source: { ...source, lineage: { relationshipToParent: null } },
    })),
  useQuietThreadShell: () => ({
    ...state.live[0],
    environmentId: "remote",
    projectId: "project",
    branch: "feature",
    runtime: null,
  }),
  readThreadShell: () => ({ ...state.live[0], branch: "feature", runtime: null }),
  useProject: () => ({ workspaceRoot: "/repo" }),
}));
vi.mock("../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({
    snapshots: [
      {
        snapshot: {
          threads: state.archived.map((thread) => ({
            ...thread,
            lineage: { relationshipToParent: null },
          })),
        },
      },
    ],
    isLoading: false,
    error: null,
  }),
  refreshArchivedThreadsForEnvironment: state.refresh,
}));
vi.mock("../state/filesystem", () => ({ filesystemEnvironment: { browse: () => null } }));
vi.mock("../state/server", async () => {
  const { Atom } = await import("effect/reactivity");
  return { primaryServerKeybindingsAtom: Atom.make([]) };
});
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { entries: state.entries.map((fullPath) => ({ fullPath })) },
    isPending: false,
    error: null,
    refresh: state.refresh,
  }),
}));
vi.mock("../state/vcs", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    vcsEnvironment: {
      renameWorktree: { permissionAtom: () => Atom.make(state.allowed) },
      createWorktree: { permissionAtom: () => Atom.make(state.allowed) },
      refreshStatus: { kind: "refreshStatus" },
      removeWorktree: {},
      listRefs: () => null,
      status: () => null,
    },
  };
});
vi.mock("../state/session", () => ({
  useEnvironmentScope: () => state.allowed,
  readEnvironmentScope: () => state.allowed,
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: { kind?: string }) =>
    command.kind === "refreshStatus" ? state.refreshStatus : state.rename,
}));
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.update,
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (draftId: string) => draftId },
  useComposerDraftStore: Object.assign(
    (select: (store: { getDraftThreadByRef: () => null }) => unknown) =>
      select({ getDraftThreadByRef: () => null }),
    { getState: () => state.draftStore },
  ),
}));

import { NamedWorktreeDialogHost, requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { WorktreePill } from "./WorktreePill";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { ConfirmDialogHost } from "./ConfirmDialogHost";
import { ThreadWorkspaceMenuHost } from "./ThreadWorkspaceMenu";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
const projectRef = {
  environmentId: EnvironmentId.make("remote"),
  projectId: ProjectId.make("project"),
};
const worktreePath = "/trees/alpha";
let root: Root;
let container: HTMLDivElement;

/** Locate one form action by its visible label. */
function button(label: string): HTMLButtonElement {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label,
  )!;
}

/** Edit through the native input so validation processes the browser's input events. */
async function renameTo(name: string) {
  await act(async () => userEvent.fill(page.getByLabelText("Worktree directory name"), name));
}

/** Open the application-owned editor with a real dialog and filesystem fixtures. */
async function openEditor() {
  await act(async () => {
    requestNamedWorktreeEdit({ projectRef, projectCwd: "/repo", worktreePath });
    root.render(<NamedWorktreeDialogHost />);
  });
}

/** Open the real workspace picker with the application confirmation host mounted. */
async function openWorkspacePicker() {
  await act(async () =>
    root.render(
      <>
        <div onContextMenu={state.parentContextMenu}>
          <WorktreePill
            threadRef={{ environmentId: projectRef.environmentId, threadId: ThreadId.make("live") }}
            projectRef={projectRef}
            projectCwd="/repo"
            worktreePath={worktreePath}
            worktree={{ name: "alpha", color: "#d3d3d3" }}
          />
        </div>
        <NamedWorktreeDialogHost />
        <ThreadWorkspaceMenuHost />
        <ConfirmDialogHost />
      </>,
    ),
  );
  await act(async () =>
    page
      .getByRole("button", { name: "Rename worktree alpha" })
      .element()
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
  );
  await act(async () => userEvent.click(page.getByText("Change worktree", { exact: true })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.rename.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { worktree: { path: "/trees/gamma", refName: "feature" } },
  });
  state.update.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  state.refresh.mockReset();
  state.parentContextMenu.mockReset();
  state.refreshStatus
    .mockReset()
    .mockResolvedValue({ _tag: "Success", value: { isRepo: true, refName: "main" } });
  state.allowed = true;
  state.entries = ["/trees/alpha", "/trees/beta"];
  state.live = [{ id: "live", projectId: "project", worktreePath, status: "completed" }];
  state.archived = [{ id: "archived", projectId: "project", worktreePath, status: "completed" }];
  state.draftStore.setDraftThreadContext.mockClear();
  useNamedWorktreeStore.setState({ selections: {}, worktrees: {} });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  const cancelButton = document.querySelector('[role="dialog"]') ? button("Cancel") : null;
  if (cancelButton && !cancelButton.disabled) {
    await act(async () => userEvent.click(cancelButton));
  }
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["/trees/alpha", "alpha", "alpha"],
  ["/trees/t3-abcd1234", "t3-abcd1234", "t3-abcd1234"],
])(
  "opens the rename dialog for %s without activating its containing sidebar row",
  async (path, label, directoryName) => {
    const activateThread = vi.fn();
    state.live[0]!.worktreePath = path;
    await act(async () =>
      root.render(
        <div onClick={activateThread}>
          <WorktreePill
            threadRef={{ environmentId: projectRef.environmentId, threadId: ThreadId.make("live") }}
            projectRef={projectRef}
            projectCwd="/repo"
            worktreePath={path}
            worktree={{ name: label, color: "#d3d3d3" }}
          />
          <NamedWorktreeDialogHost />
        </div>,
      ),
    );
    await act(async () =>
      userEvent.click(page.getByRole("button", { name: `Rename worktree ${label}`, exact: true })),
    );
    expect(activateThread).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Rename worktree");
    expect(document.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe(
      directoryName,
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => userEvent.keyboard("{Escape}"));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
);

it.each([
  ["Rename worktree", "mouse"],
  ["Rename worktree", "keyboard"],
  ["Change worktree", "mouse"],
  ["Change worktree", "keyboard"],
])(
  "restores pill focus only when %s was opened by keyboard: %s",
  async (dialogTitle, openingMethod) => {
    await act(async () =>
      root.render(
        <>
          <Tooltip>
            <TooltipTrigger render={<div role="button" aria-label="Thread row" tabIndex={0} />}>
              <WorktreePill
                threadRef={{
                  environmentId: projectRef.environmentId,
                  threadId: ThreadId.make("live"),
                }}
                projectRef={projectRef}
                projectCwd="/repo"
                worktreePath={worktreePath}
                worktree={{ name: "alpha", color: "#808080" }}
              />
            </TooltipTrigger>
            <TooltipPopup>Thread details</TooltipPopup>
          </Tooltip>
          <NamedWorktreeDialogHost />
          <ThreadWorkspaceMenuHost />
        </>,
      ),
    );
    const pill = page.getByRole("button", { name: "Rename worktree alpha", exact: true });
    await act(async () => {
      if (openingMethod === "keyboard") {
        await userEvent.tab();
        await userEvent.tab();
      }
      if (dialogTitle === "Change worktree") {
        if (openingMethod === "mouse") {
          await userEvent.click(pill, { button: "right" });
        } else {
          pill
            .element()
            .dispatchEvent(
              new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }),
            );
        }
        await userEvent.click(page.getByText("Change worktree", { exact: true }));
      } else {
        if (openingMethod === "mouse") await userEvent.click(pill);
        else await userEvent.keyboard("{Enter}");
      }
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(dialogTitle);
    await act(async () => userEvent.keyboard("{Escape}"));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    if (openingMethod === "keyboard") {
      await vi.waitFor(() => expect(document.activeElement).toBe(pill.element()));
    } else {
      expect(document.activeElement).not.toBe(pill.element());
      expect(pill.element().matches(":focus-visible")).toBe(false);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    }
  },
);

it("changes worktrees from the pill context menu without opening the parent thread menu", async () => {
  await openWorkspacePicker();
  expect(state.parentContextMenu).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Change worktree");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(page.getByRole("radio", { name: /alpha/ }).element().getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => userEvent.keyboard("{Escape}"));
  await act(async () =>
    page
      .getByRole("button", { name: "Rename worktree alpha" })
      .element()
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
  );
  await act(async () => userEvent.click(page.getByText("Rename worktree", { exact: true })));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Rename worktree");
  expect(state.parentContextMenu).not.toHaveBeenCalled();
  await act(async () => userEvent.click(button("Cancel")));
});

it("disables Save for a sibling collision and recovers when the name changes", async () => {
  await openEditor();
  await renameTo("beta");
  expect(button("Save").disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("already exists");
  await renameTo("gamma");
  expect(button("Save").disabled).toBe(false);
  await act(async () => userEvent.click(button("Save")));
  expect(state.rename).toHaveBeenCalledWith({
    environmentId: "remote",
    input: { cwd: "/repo", path: worktreePath, newDirName: "gamma" },
  });
  expect(state.update).toHaveBeenCalledWith({
    environmentId: "remote",
    input: { threadId: "live", worktreePath: "/trees/gamma" },
  });
  expect(state.update).toHaveBeenCalledWith({
    environmentId: "remote",
    input: { threadId: "archived", worktreePath: "/trees/gamma" },
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("saves color without calling Git or changing thread paths", async () => {
  await openEditor();
  await act(async () =>
    userEvent.click(
      document.querySelector<HTMLButtonElement>('[aria-label="Teal worktree color"]')!,
    ),
  );
  await act(async () => userEvent.click(button("Save")));
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(
    useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, worktreePath)]?.color,
  ).toBe("#14b8a6");
});

it("keeps a race-time collision open and disables resubmission of that name", async () => {
  state.rename.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(
      new GitCommandError({
        operation: "rename",
        command: "git",
        cwd: "/repo",
        detail: "The target directory already exists.",
      }),
    ),
  });
  await openEditor();
  await renameTo("gamma");
  await act(async () => userEvent.click(button("Save")));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("already exists");
  expect(button("Save").disabled).toBe(true);
  expect(state.update).not.toHaveBeenCalled();
  await renameTo("delta");
  expect(button("Save").disabled).toBe(false);
});

it("retries thread updates without moving an already renamed directory twice", async () => {
  state.update.mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("offline")) });
  await openEditor();
  await renameTo("gamma");
  await act(async () => userEvent.click(button("Save")));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Save again to retry");
  expect(button("Cancel").disabled).toBe(true);
  await act(async () => userEvent.click(button("Save")));
  expect(state.rename).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("blocks renaming a running worktree but still allows color changes", async () => {
  state.live[0]!.status = "running";
  await openEditor();
  await renameTo("gamma");
  expect(button("Save").disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Stop running agents");
  await renameTo("alpha");
  await act(async () =>
    userEvent.click(
      document.querySelector<HTMLButtonElement>('[aria-label="Teal worktree color"]')!,
    ),
  );
  expect(button("Save").disabled).toBe(false);
});

it.each(["Cancel", "Change worktree"])(
  "%s in the change dialog controls whether the thread moves",
  async (action) => {
    await openWorkspacePicker();
    expect(button("Change worktree").disabled).toBe(true);
    await act(async () => userEvent.click(page.getByRole("radio", { name: /Local checkout/ })));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Files and uncommitted changes will stay in the current checkout",
    );
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.update).not.toHaveBeenCalled();
    await act(async () => userEvent.click(page.getByRole("button", { name: action, exact: true })));
    if (action === "Change worktree") {
      await vi.waitFor(() =>
        expect(state.update).toHaveBeenCalledWith({
          environmentId: "remote",
          input: {
            threadId: "live",
            branch: "main",
            worktreePath: null,
            expectedBranch: "feature",
            expectedWorktreePath: worktreePath,
            expectedIdle: true,
          },
        }),
      );
    } else {
      expect(state.update).not.toHaveBeenCalled();
    }
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(state.rename).not.toHaveBeenCalled();
  },
);

it("keeps new worktree edits while reviewing another destination and cancels without creating", async () => {
  await openWorkspacePicker();
  await act(async () =>
    userEvent.click(page.getByRole("radio", { name: "New worktree", exact: true })),
  );
  await act(async () => userEvent.fill(page.getByLabelText("Worktree name"), "billing-fix"));
  await act(async () => userEvent.click(page.getByRole("radio", { name: /Local checkout/ })));
  await act(async () =>
    userEvent.click(page.getByRole("radio", { name: "New worktree", exact: true })),
  );
  const worktreeNameInput = page.getByLabelText("Worktree name").element() as HTMLInputElement;
  expect(worktreeNameInput.value).toBe("billing-fix");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Create worktree "billing-fix"',
  );
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  await act(async () => userEvent.click(page.getByRole("button", { name: "Cancel", exact: true })));
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("creates a named worktree only after the dialog's final confirmation", async () => {
  await openWorkspacePicker();
  await act(async () =>
    userEvent.click(page.getByRole("radio", { name: "New worktree", exact: true })),
  );
  await act(async () => userEvent.fill(page.getByLabelText("Worktree name"), "billing-fix"));
  await act(async () =>
    userEvent.click(page.getByRole("button", { name: "Worktree color", exact: true })),
  );
  await act(async () => userEvent.click(page.getByRole("button", { name: "Teal worktree color" })));
  await act(async () => userEvent.keyboard("{Escape}"));
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  await act(async () =>
    userEvent.click(page.getByRole("button", { name: "Change worktree", exact: true })),
  );
  await vi.waitFor(() =>
    expect(state.rename).toHaveBeenCalledWith({
      environmentId: "remote",
      input: {
        cwd: "/repo",
        refName: "feature",
        baseRefName: "feature",
        newRefName: "billing-fix",
        directoryName: "billing-fix",
        path: null,
      },
    }),
  );
  expect(state.update).toHaveBeenCalled();
  expect(
    useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, "/trees/gamma")]?.color,
  ).toBe("#14b8a6");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
});

it("requires a valid directory name before confirming a new worktree", async () => {
  await openWorkspacePicker();
  await act(async () =>
    userEvent.click(page.getByRole("radio", { name: "New worktree", exact: true })),
  );
  expect(button("Change worktree").disabled).toBe(true);
  await act(async () => userEvent.fill(page.getByLabelText("Worktree name"), "../outside"));
  expect(button("Change worktree").disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "without path separators",
  );
  await act(async () => userEvent.fill(page.getByLabelText("Worktree name"), "valid-name"));
  expect(button("Change worktree").disabled).toBe(false);
  expect(state.rename).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("keeps validation failures in the change dialog and retries the same destination", async () => {
  state.refreshStatus.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Checkout unavailable")),
  });
  await openWorkspacePicker();
  await act(async () => userEvent.click(page.getByRole("radio", { name: /Local checkout/ })));
  await act(async () =>
    userEvent.click(page.getByRole("button", { name: "Change worktree", exact: true })),
  );
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Checkout unavailable",
    ),
  );
  expect(state.update).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await act(async () =>
    userEvent.click(page.getByRole("button", { name: "Change worktree", exact: true })),
  );
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
});
