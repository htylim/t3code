import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useNowMinute", () => ({
  useNowMinute: () => "2026-11-06T10:20",
}));
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({ open: "new-thread-in" });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

it("shows the same recency that positions reactivated threads and their workspace cards", async () => {
  using stack = new DisposableStack();
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    forkGroupSidebarWorkspaces: true,
    sidebarWorkingShelfEnabled: true,
  });
  const workspaceProject = project("recency");
  const reactivated = makeThreadFixture({
    id: ThreadId.make("reactivated"),
    environmentId: workspaceProject.environmentId,
    projectId: workspaceProject.id,
    title: "Reactivated conversation",
    worktreePath: "/projects/recency/shared",
    createdAt: "2026-11-06T00:00:00.000Z",
    latestUserMessageAt: "2026-11-06T01:00:00.000Z",
    unsettledAt: "2026-11-06T10:19:00.000Z",
  });
  const sibling = {
    ...reactivated,
    id: ThreadId.make("sibling"),
    title: "Older shared conversation",
    unsettledAt: "2026-11-06T10:10:00.000Z",
  };
  const otherWorkspace = {
    ...reactivated,
    id: ThreadId.make("other-workspace"),
    title: "Other workspace conversation",
    worktreePath: "/projects/recency/other",
    latestUserMessageAt: "2026-11-06T10:15:00.000Z",
    unsettledAt: "2026-11-06T10:15:00.000Z",
  };
  vi.mocked(useProjects).mockReturnValue([workspaceProject]);
  vi.mocked(useQuietThreadShells).mockReturnValue([sibling, otherWorkspace, reactivated]);
  stack.defer(() => vi.mocked(useQuietThreadShells).mockReset());
  await using screen = await render(
    <SidebarProvider>
      <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
    </SidebarProvider>,
  );

  await vi.waitFor(() => {
    const rows = Array.from(screen.container.querySelectorAll("[data-thread-item]"));
    expect(rows.map((row) => row.getAttribute("data-thread-item"))).toEqual([
      "local:reactivated",
      "local:sibling",
      "local:other-workspace",
    ]);
    expect(rows[0]?.querySelector("time")?.textContent).toBe("1m");
    expect(rows[1]?.querySelector("time")?.textContent).toBe("10m");
    expect(rows[2]?.querySelector("time")?.textContent).toBe("5m");
  });
});
