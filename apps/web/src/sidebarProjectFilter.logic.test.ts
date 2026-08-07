import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";
import {
  buildSidebarProjectFilterActionItems,
  handleSidebarProjectFilterShortcut,
  isSidebarProjectFilterAvailable,
} from "./sidebarProjectFilter.logic";
import type { Project } from "./types";

const primaryEnvironmentId = EnvironmentId.make("env-primary");
const remoteEnvironmentId = EnvironmentId.make("env-remote");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-primary"),
    environmentId: primaryEnvironmentId,
    title: "Primary checkout",
    workspaceRoot: "/workspace/primary",
    repositoryIdentity: {
      canonicalKey: "github.com/example/shared",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/example/shared.git",
      },
    },
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

function projectGroups() {
  return buildSidebarProjectSnapshots({
    projects: [
      makeProject(),
      makeProject({
        id: ProjectId.make("project-remote"),
        environmentId: remoteEnvironmentId,
        title: "Remote checkout",
        workspaceRoot: "/srv/shared",
      }),
    ],
    settings: {
      sidebarProjectGroupingMode: "repository",
      sidebarProjectGroupingOverrides: {},
    },
    primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
}

describe("sidebar project filter availability", () => {
  it("requires a mounted Sidebar v2 and at least one logical project", () => {
    expect(
      isSidebarProjectFilterAvailable({
        sidebarV2Enabled: true,
        pathname: "/env/thread",
        projectGroupCount: 1,
      }),
    ).toBe(true);
    expect(
      isSidebarProjectFilterAvailable({
        sidebarV2Enabled: false,
        pathname: "/env/thread",
        projectGroupCount: 1,
      }),
    ).toBe(false);
    expect(
      isSidebarProjectFilterAvailable({
        sidebarV2Enabled: true,
        pathname: "/settings/keybindings",
        projectGroupCount: 1,
      }),
    ).toBe(false);
    expect(
      isSidebarProjectFilterAvailable({
        sidebarV2Enabled: true,
        pathname: "/env/thread",
        projectGroupCount: 0,
      }),
    ).toBe(false);
  });
});

describe("handleSidebarProjectFilterShortcut", () => {
  it("opens the picker even when another palette surface is already open", () => {
    const event = { repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const open = vi.fn();

    expect(
      handleSidebarProjectFilterShortcut({
        command: "sidebar.projectFilter",
        available: true,
        event,
        open,
      }),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("ignores repeats and unavailable surfaces", () => {
    const open = vi.fn();
    const repeated = { repeat: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(
      handleSidebarProjectFilterShortcut({
        command: "sidebar.projectFilter",
        available: true,
        event: repeated,
        open,
      }),
    ).toBe(false);
    expect(repeated.preventDefault).not.toHaveBeenCalled();

    expect(
      handleSidebarProjectFilterShortcut({
        command: "sidebar.projectFilter",
        available: false,
        event: { repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
        open,
      }),
    ).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("buildSidebarProjectFilterActionItems", () => {
  it("keeps All projects first and searches every logical-group member", async () => {
    const requestScope = vi.fn();
    const groups = projectGroups();
    const items = buildSidebarProjectFilterActionItems({
      groups,
      allProjectsIcon: null,
      projectIcon: () => null,
      requestScope,
    });

    expect(items.map((item) => item.value)).toEqual([
      "project-filter:all",
      `project-filter:${groups[0]?.projectKey}`,
    ]);
    expect(items[1]?.searchTerms).toEqual(
      expect.arrayContaining([
        groups[0]?.displayName,
        "Primary checkout",
        "/workspace/primary",
        "Remote checkout",
        "/srv/shared",
      ]),
    );

    await items[0]?.run();
    await items[1]?.run();
    expect(requestScope.mock.calls).toEqual([[null], [groups[0]?.projectKey]]);
  });
});
