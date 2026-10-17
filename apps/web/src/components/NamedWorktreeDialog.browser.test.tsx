import "../index.css";
import { EnvironmentId, GitCommandError, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

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
  allowed: true,
  entries: ["/trees/alpha", "/trees/beta"],
  live: [] as TestThread[],
  archived: [] as TestThread[],
  draftStore: { draftThreadsByThreadKey: {}, setDraftThreadContext: vi.fn() },
}));
vi.mock("../state/entities", () => ({
  useThreadShellsForProjectRefs: () => state.live.map((source) => ({ source })),
}));
vi.mock("../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({
    snapshots: [{ snapshot: { threads: state.archived } }],
    isLoading: false,
    error: null,
  }),
  refreshArchivedThreadsForEnvironment: state.refresh,
}));
vi.mock("../state/filesystem", () => ({ filesystemEnvironment: { browse: () => null } }));
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
  return { vcsEnvironment: { renameWorktree: { permissionAtom: () => Atom.make(state.allowed) } } };
});
vi.mock("../state/session", () => ({ useEnvironmentScope: () => state.allowed }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.rename }));
vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => state.update,
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (draftId: string) => draftId },
  useComposerDraftStore: { getState: () => state.draftStore },
}));

import { NamedWorktreeDialogHost, requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { NamedWorktreePill } from "./NamedWorktreePill";
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
  await act(async () =>
    userEvent.fill(document.querySelector<HTMLInputElement>("input[aria-describedby]")!, name),
  );
}

/** Open the application-owned editor with a real dialog and filesystem fixtures. */
async function openEditor() {
  await act(async () => {
    requestNamedWorktreeEdit({ projectRef, projectCwd: "/repo", worktreePath });
    root.render(<NamedWorktreeDialogHost />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.rename.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { worktree: { path: "/trees/gamma", refName: "feature" } },
  });
  state.update.mockReset().mockResolvedValue({ _tag: "Success", value: {} });
  state.refresh.mockReset();
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
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens from a pill without activating its containing sidebar row", async () => {
  const activateThread = vi.fn();
  await act(async () =>
    root.render(
      <div onClick={activateThread}>
        <NamedWorktreePill
          projectRef={projectRef}
          projectCwd="/repo"
          worktreePath={worktreePath}
          worktree={{ name: "alpha", color: "#8b5cf6" }}
        />
        <NamedWorktreeDialogHost />
      </div>,
    ),
  );
  await act(async () =>
    userEvent.click(
      document.querySelector<HTMLButtonElement>('[aria-label="Edit worktree alpha"]')!,
    ),
  );
  expect(activateThread).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Rename worktree");
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
