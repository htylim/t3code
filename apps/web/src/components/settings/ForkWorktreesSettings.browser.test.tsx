import "../../index.css";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { vcsEnvironment } from "../../state/vcs";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import type { WorktreeMeasurement } from "./useWorktreeCleanup";
import { worktreeCleanupKey } from "./worktreeBulkCleanup";
import type { useWorkspaceChoices } from "../../hooks/useWorkspaceChoices";

const state = vi.hoisted(() => ({
  projects: [] as SidebarProjectGroupMember[],
  connected: true,
  scopeKind: "all" as "all" | "project",
  measurements: new Map<string, Map<string, WorktreeMeasurement>>(),
  choices: new Map<string, ReturnType<typeof useWorkspaceChoices>>(),
}));

vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: state.scopeKind, environmentIds: ["local"], members: state.projects },
    groups: state.projects.map((project) => ({
      displayName: project.title,
      memberProjects: [project],
    })),
    environments: [
      {
        environmentId: "local",
        connection: { phase: state.connected ? "connected" : "disconnected" },
        serverConfig: { environment: { capabilities: { fork: { worktrees: { apiVersion: 1 } } } } },
      },
    ],
  })) as never,
}));
vi.mock(import("../../hooks/useWorkspaceChoices"), () => ({
  useWorkspaceChoices: (props) => state.choices.get(props.projectCwd)!,
}));
vi.mock(import("./useWorktreeCleanup"), () => ({
  useWorktreeCleanup: (() => ({ pending: false, clean: vi.fn() })) as never,
  useWorktreeMeasurements: (targets) => {
    const key = JSON.stringify(targets);
    let measurements = state.measurements.get(key);
    if (measurements === undefined) {
      measurements = new Map(
        targets.map((target) => [
          worktreeCleanupKey(target),
          { bytes: 1024, pending: false, error: null },
        ]),
      );
      state.measurements.set(key, measurements);
    }
    return measurements;
  },
  worktreeSpaceEstimate: () => "~1.00 KB to reclaim",
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({ data: null, error: null, isSuccess: true })) as never,
}));
vi.mock(import("../WorktreeActionsMenu"), () => ({ WorktreeActionsMenu: () => <></> }));
vi.mock(import("./forkSettingsAvailability"), () => ({ FORK_SETTINGS_AVAILABLE: true }));

import { ForkWorktreesSettings } from "./ForkWorktreesSettings";

/** Seed an empty checkout and populated checkouts, including the special scratch project. */
function setup() {
  state.projects = [];
  state.scopeKind = "all";
  state.connected = true;
  state.choices.clear();
  state.measurements.clear();
  for (const title of ["Empty", "Repository", "No project"]) {
    const workspaceRoot = `/repos/${title}`;
    state.projects.push({
      id: ProjectId.make(title),
      environmentId: EnvironmentId.make("local"),
      title,
      workspaceRoot,
      physicalProjectKey: workspaceRoot,
      environmentLabel: "Local",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-11-04T00:00:00.000Z",
      updatedAt: "2026-11-04T00:00:00.000Z",
      ...(title === "No project" ? { isScratch: true as const } : {}),
    });
    const refs = [{ name: "main", worktreePath: workspaceRoot, current: true, isDefault: true }];
    const rows =
      title === "Empty"
        ? []
        : [
            {
              worktreePath: `${workspaceRoot}/review`,
              dirName: "review",
              refName: "review",
              isBusy: false,
              isIdle: true,
            },
          ];
    state.choices.set(workspaceRoot, {
      refsQuery: {
        data: {
          refs,
          mainWorktreePath: workspaceRoot,
          isRepo: true,
          hasPrimaryRemote: false,
          nextCursor: null,
          totalCount: refs.length,
        },
        error: null,
        dataUpdatedAt: 0,
        failure: null,
        isPending: true,
        isSuccess: true,
        refresh: vi.fn(),
      },
      archived: { isLoading: false, error: null, snapshots: [], refresh: vi.fn() },
      threads: [],
      rows,
      localRef: refs[0],
    });
  }
}

it("hides empty and scratch projects while keeping searchable worktrees", async () => {
  setup();
  using _permissions = vi
    .spyOn(vcsEnvironment.removeWorktree, "permissionAtom")
    .mockReturnValue(Atom.make(true));
  await using screen = await render(<ForkWorktreesSettings />);
  await expect
    .element(screen.getByRole("heading", { name: "Repository", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Empty", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("heading", { name: "No project", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("status")).toHaveTextContent("~1.00 KB total used");
  await userEvent.click(screen.getByRole("button", { name: "Delete Worktrees..." }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("~1.00 KB total used");
  await userEvent.click(screen.getByRole("checkbox", { name: "Select review", exact: true }));
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("~1.00 KB to reclaim (of ~1.00 KB total used) · 1 selected");
  await userEvent.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  await userEvent.fill(screen.getByRole("searchbox"), "missing");
  await expect.element(screen.getByRole("status")).toHaveTextContent("~0 B total used");
  await expect
    .element(screen.getByRole("heading", { name: "Repository", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.clear(screen.getByRole("searchbox"));
  await expect
    .element(screen.getByRole("heading", { name: "Repository", exact: true }))
    .toBeVisible();
  state.scopeKind = "project";
  await screen.rerender(<ForkWorktreesSettings />);
  await expect.element(screen.getByRole("heading", { name: "Empty", exact: true })).toBeVisible();
  await expect.element(screen.getByText("No worktrees found.", { exact: true })).toBeVisible();
  state.connected = false;
  await screen.rerender(<ForkWorktreesSettings />);
  await expect.element(screen.getByText(/total used/)).not.toBeInTheDocument();
  state.connected = true;
  await screen.rerender(<ForkWorktreesSettings />);
  await expect.element(screen.getByRole("status")).toHaveTextContent("~1.00 KB total used");
  await expect
    .element(screen.getByRole("heading", { name: "No project", exact: true }))
    .not.toBeInTheDocument();
});
