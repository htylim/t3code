import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

vi.mock("../state/entities", () => ({ useThreadShellsForProjectRefs: () => [] }));
vi.mock("../lib/archivedThreadsState", () => ({
  refreshArchivedThreadsForEnvironment: vi.fn(),
  useArchivedThreadSnapshots: () => ({ snapshots: [], isLoading: false, error: null }),
}));
vi.mock("../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      refs: ["alpha", "billing-fix", "zeta"].map((name) => ({
        name: `feature/${name}`,
        worktreePath: `/tmp/${name}`,
        isRemote: false,
        current: false,
        isDefault: false,
      })),
      workingTree: { files: [] },
      aheadCount: 0,
      hasUpstream: true,
    },
    isPending: false,
  }),
}));

import { WorkspaceMenu, type WorkspaceMenuProps } from "./WorkspaceMenu";

let root: Root;
let container: HTMLDivElement;
const environmentId = EnvironmentId.make("local");
const projectRef = { environmentId, projectId: ProjectId.make("project") };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Open the actual workspace picker with a saved name, even when another option is active. */
async function openWorkspace(overrides: Partial<WorkspaceMenuProps> = {}) {
  await act(async () => {
    root.render(
      <WorkspaceMenu
        environmentId={environmentId}
        projectRef={projectRef}
        projectCwd="/tmp/project"
        activeWorktreePath={null}
        activeBranch="main"
        envLocked={false}
        canUseWorktree
        effectiveEnvMode="local"
        namedWorktreeSelection={{ name: "billing-fix", color: "#14b8a6" }}
        onEnvModeChange={vi.fn()}
        onUseWorktree={vi.fn()}
        onNewWorktreeSelect={vi.fn()}
        {...overrides}
      />,
    );
  });
  await act(async () => userEvent.click(container.querySelector<HTMLButtonElement>("button")!));
}

it.each([
  ["local checkout", { effectiveEnvMode: "local" }, '[role="menuitemradio"][aria-checked="true"]'],
  [
    "automatic creation",
    { effectiveEnvMode: "worktree", namedWorktreeSelection: null },
    '[role="menuitemradio"][aria-checked="true"]',
  ],
  ["named creation", { effectiveEnvMode: "worktree" }, '[aria-label="Worktree name"]'],
  [
    "existing worktree",
    { effectiveEnvMode: "worktree", activeWorktreePath: "/tmp/billing-fix" },
    '[aria-current="true"]',
  ],
] satisfies [string, Partial<WorkspaceMenuProps>, string][])(
  "focuses the selected %s when opened",
  async (_label, overrides, selector) => {
    await openWorkspace(overrides);
    const selectedOption = document.querySelector<HTMLElement>(selector)!;
    expect(selectedOption).not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(selectedOption));
    if (selectedOption.getAttribute("role") === "menuitemradio") {
      expect(selectedOption.hasAttribute("data-highlighted")).toBe(true);
    }
  },
);

it("allows keyboard navigation after focusing the current option", async () => {
  await openWorkspace({ namedWorktreeSelection: null });
  await act(async () => userEvent.keyboard("{ArrowDown}"));
  await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("New worktree"));
  await act(async () => userEvent.keyboard("{Escape}"));
  await act(async () => userEvent.click(container.querySelector<HTMLButtonElement>("button")!));
  await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("local checkout"));
});

/** Match a breadcrumb request's controlled popup and virtual anchor, without a menu trigger. */
function StandaloneWorkspaceFixture({ onSelect }: { onSelect: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <WorkspaceMenu
      environmentId={environmentId}
      projectRef={projectRef}
      projectCwd="/tmp/project"
      activeWorktreePath={null}
      activeBranch="main"
      envLocked={false}
      canUseWorktree
      effectiveEnvMode="local"
      requireWorktreeName
      interactionMode="standalone"
      open={open}
      onOpenChange={setOpen}
      anchor={{ getBoundingClientRect: () => new DOMRect(180, 180) }}
      onEnvModeChange={onSelect}
      onNewWorktreeSelect={onSelect}
      onUseWorktree={onSelect}
    />
  );
}

it("keeps a standalone picker open on pointer leave and discards edits on Escape", async () => {
  const onSelect = vi.fn();
  await act(async () => root.render(<StandaloneWorkspaceFixture onSelect={onSelect} />));
  const input = page.getByLabelText("Worktree name");
  await act(async () => userEvent.fill(input, "uncommitted-workspace"));
  await act(async () => userEvent.hover(input));
  await act(async () => userEvent.hover(document.body));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('[aria-label="Worktree name"]')?.value).toBe(
    "uncommitted-workspace",
  );
  await act(async () => userEvent.keyboard("{Escape}"));
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  expect(onSelect).not.toHaveBeenCalled();
});

it.each(["Escape", "outside click", "selection"])(
  "dismisses a standalone picker through %s",
  async (action) => {
    const onSelect = vi.fn();
    await act(async () => root.render(<StandaloneWorkspaceFixture onSelect={onSelect} />));
    await act(async () => {
      if (action === "Escape") await userEvent.keyboard("{Escape}");
      else if (action === "outside click") await userEvent.click(document.body);
      else await userEvent.click(page.getByRole("menuitemradio").first());
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(onSelect).toHaveBeenCalledTimes(action === "selection" ? 1 : 0);
  },
);

/** Read the visible worktree names independently of their selected or status labels. */
function worktreeNames() {
  const worktreeGroup = document.querySelectorAll('[data-slot="menu-group"]')[1]!;
  return [...worktreeGroup.querySelectorAll('[role="menuitemradio"]')].map(
    (row) => row.querySelector(".truncate")?.textContent,
  );
}

it("keeps a selected existing worktree in its original list position", async () => {
  const onUseWorktree = vi.fn();
  await openWorkspace({ onUseWorktree });
  expect(worktreeNames()).toEqual(["alpha", "billing-fix", "zeta"]);
  await act(async () =>
    userEvent.click(
      document
        .querySelectorAll('[data-slot="menu-group"]')[1]!
        .querySelectorAll<HTMLElement>('[role="menuitemradio"]')[1]!,
    ),
  );
  expect(onUseWorktree).toHaveBeenCalledWith({
    branch: "feature/billing-fix",
    worktreePath: "/tmp/billing-fix",
  });
  await openWorkspace({ effectiveEnvMode: "worktree", activeWorktreePath: "/tmp/billing-fix" });
  expect(worktreeNames()).toEqual(["alpha", "billing-fix", "zeta"]);
  const selectedRow = document.querySelector('[role="menuitemradio"][aria-checked="true"]')!;
  expect(selectedRow.querySelector(".truncate")?.textContent).toBe("billing-fix");
  expect(selectedRow.closest('[data-slot="menu-group"]')).toBe(
    document.querySelectorAll('[data-slot="menu-group"]')[1],
  );
});
