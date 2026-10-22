import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  worktreePath: "/tmp/worktree" as string | null,
  branch: "t3/1234abcd" as string | null,
  showContextMenu: vi.fn(),
  writeTextToClipboard: vi.fn(),
}));

vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: (() => ({ contextMenu: { show: state.showContextMenu }, shell: {} })) as never,
}));
vi.mock(import("../hooks/useCopyToClipboard"), async (original) => ({
  ...(await original()),
  writeTextToClipboard: state.writeTextToClipboard,
}));
vi.mock(import("./BranchToolbarBranchSelector"), async (original) => ({
  ...(await original()),
  BranchToolbarBranchSelector: (() => null) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useQuietThreadShell: (() => ({
    environmentId: "local",
    projectId: "project",
    worktreePath: state.worktreePath,
    branch: state.branch,
  })) as never,
  useProject: (() => ({ workspaceRoot: "/tmp/project" })) as never,
  useThreadShellsForProjectRefs: () => [],
}));

import { BranchToolbar } from "./BranchToolbar";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.worktreePath = "/tmp/worktree";
  state.branch = "t3/1234abcd";
  useNamedWorktreeStore.setState({ selections: {}, worktrees: {} });
  state.showContextMenu.mockReset().mockResolvedValue("copy-path");
  state.writeTextToClipboard.mockReset().mockResolvedValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Mount the shared toolbar with only the context needed by each browser scenario. */
function render(props: Partial<ComponentProps<typeof BranchToolbar>>) {
  return act(async () =>
    root.render(
      <BranchToolbar
        layout="panel"
        panelSection="workspace"
        environmentId={EnvironmentId.make("local")}
        threadId={ThreadId.make("thread")}
        showGitControls
        envMode="local"
        envLocked={false}
        startFromOrigin={false}
        onStartFromOriginChange={vi.fn()}
        onEnvModeChange={vi.fn()}
        {...props}
      />,
    ),
  );
}

it("keeps machine choices usable when the combined row's workspace is locked", async () => {
  const onEnvironmentChange = vi.fn();
  await render({
    onEnvironmentChange,
    availableEnvironments: ["local", "remote"].map((id) => ({
      environmentId: EnvironmentId.make(id),
      projectId: ProjectId.make("project"),
      label: id,
      isPrimary: id === "local",
      machine: "server",
    })),
  });
  const trigger = container.querySelector("button")!;
  expect(trigger.textContent).toBe("local");
  expect(container.querySelectorAll("button")).toHaveLength(1);

  // A ctrl-click is a macOS secondary click; it must not open the menu.
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, ctrlKey: true }));
  });
  expect(document.querySelector('[role="menu"]')).toBeNull();

  await userEvent.click(trigger);
  const newWorktree = [...document.querySelectorAll('[role="menuitemradio"]')].find((option) =>
    option.textContent?.startsWith("New worktree"),
  );
  expect(newWorktree?.getAttribute("aria-disabled")).toBe("true");
  await userEvent.click(page.getByRole("menuitemradio", { name: "remote" }));
  expect(onEnvironmentChange).toHaveBeenCalledWith("remote");
});

it("shows a started thread's primary machine as a static label in the composer", async () => {
  await render({
    layout: "composer",
    showGitControls: false,
    availableEnvironments: ["local", "remote"].map((id) => ({
      environmentId: EnvironmentId.make(id),
      projectId: ProjectId.make("project"),
      label: id,
      isPrimary: id === "local",
      machine: "server",
    })),
  });
  expect(container.textContent).toBe("local");
  expect(container.querySelector("button")).toBeNull();
});

it.each([
  ["local", null, "/tmp/project"],
  ["worktree", null, null],
  ["worktree", "/tmp/worktree", "/tmp/worktree"],
] as const)(
  "copies only an existing workspace path with mode %s and worktree %s",
  async (envMode, worktreePath, copiedPath) => {
    state.worktreePath = worktreePath;
    await render({ envMode });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => {
      container.querySelector('[aria-label="Run context"]')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(copiedPath !== null);
    if (copiedPath === null) {
      expect(state.showContextMenu).not.toHaveBeenCalled();
      expect(state.writeTextToClipboard).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() =>
        expect(state.writeTextToClipboard).toHaveBeenCalledWith(copiedPath, "workspace path"),
      );
    }
  },
);

it.each([
  ["/tmp/billing-fix", "#14b8a6", "billing-fix", true],
  ["/tmp/billing-fix", null, "billing-fix", true],
  ["/tmp/billing-fix", null, "billing-fix", false],
  ["/tmp/t3-1234abcd", null, "t3-1234abcd", true],
  ["/tmp/t3code-1234abcd", null, "t3code-1234abcd", false],
  [null, null, null, true],
] as const)(
  "shows every assigned worktree below the branch for %s with saved color %s, label %s, Git controls %s",
  async (worktreePath, savedColor, expectedName, showGitControls) => {
    state.worktreePath = worktreePath;
    const projectRef = {
      environmentId: EnvironmentId.make("local"),
      projectId: ProjectId.make("project"),
    };
    useNamedWorktreeStore.setState({
      selections: {},
      worktrees:
        worktreePath && savedColor
          ? { [namedWorktreeKey(projectRef, worktreePath)]: { color: savedColor } }
          : {},
    });
    await render({ panelSection: "branch", showGitControls, envMode: "worktree", envLocked: true });
    const worktreeLabel = container.querySelector('[aria-label="Worktree"]');
    if (expectedName) {
      expect(worktreeLabel?.textContent).toBe(expectedName);
      const worktreePill = worktreeLabel?.querySelector<HTMLElement>('[data-slot="soft-pill"]');
      expect(worktreePill?.textContent).toBe(expectedName);
      expect(worktreePill?.style.backgroundColor).toContain(
        savedColor ? "20, 184, 166" : "211, 211, 211",
      );
    } else {
      expect(worktreeLabel).toBeNull();
    }
  },
);

it("updates an automatic pill when first-prompt naming moves its directory", async () => {
  state.worktreePath = "/tmp/t3-1234abcd";
  const props = { panelSection: "branch", envMode: "worktree", envLocked: true } as const;
  await render(props);
  expect(container.querySelector('[aria-label="Worktree"]')?.textContent).toBe("t3-1234abcd");
  state.worktreePath = "/tmp/fix-sidebar-pills";
  state.branch = "fix/sidebar-pills";
  await render(props);
  expect(container.querySelector('[aria-label="Worktree"]')?.textContent).toBe("fix-sidebar-pills");
  expect(
    container
      .querySelector('[aria-label="Worktree"] [data-slot="soft-pill"]')
      ?.getAttribute("style"),
  ).toContain("211, 211, 211");
});
