import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveSidebarThreadAttention } from "../../components/Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { makeThreadFixture } from "../../test-fixtures";
import { reactHookHarness } from "../../test/reactHookHarness";
import {
  buildProjectCardGroups,
  projectCardThreadKey,
  projectCardThreadTimestampMs,
  projectCardVisibleThreads,
} from "./projectCards.logic";
import type { ProjectCardState } from "./preferences";
import { useProjectCards } from "./useProjectCards";

const preferenceState = vi.hoisted(() => ({ states: {} as Record<string, ProjectCardState> }));
vi.mock("./preferences", () => ({
  useProjectCardStates: () => [
    preferenceState.states,
    (update: (previous: Record<string, ProjectCardState>) => Record<string, ProjectCardState>) => {
      preferenceState.states = update(preferenceState.states);
    },
  ],
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useMemo: reactHookHarness.useMemo,
    useState: reactHookHarness.useState,
  };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

const environmentId = EnvironmentId.make("card-environment");

/** Make a complete project snapshot without inventing server or runtime state. */
function makeProjectCard(
  projectId: string,
  projectEnvironmentId = environmentId,
): SidebarProjectSnapshot {
  const project = {
    id: ProjectId.make(projectId),
    environmentId: projectEnvironmentId,
    title: projectId,
    workspaceRoot: `/tmp/${projectId}`,
    repositoryIdentity: null,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
  return {
    ...project,
    projectKey: `${projectEnvironmentId}:${projectId}`,
    displayName: projectId,
    groupedProjectCount: 1,
    environmentPresence: "local-only",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    remoteEnvironmentLabels: [],
    memberProjects: [
      {
        ...project,
        physicalProjectKey: `${projectEnvironmentId}:${projectId}`,
        environmentLabel: null,
      },
    ],
    memberProjectRefs: [scopeProjectRef(projectEnvironmentId, project.id)],
  };
}

/** Produce distinct rows with explicit displayed ages for sorting and preview tests. */
function makeCardThread(
  id: string,
  timestamp: string,
  projectId = "project-a",
  projectEnvironmentId = environmentId,
) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: projectEnvironmentId,
    projectId: ProjectId.make(projectId),
    latestUserMessageAt: timestamp,
  });
}

const projectA = makeProjectCard("project-a");
const projectB = makeProjectCard("project-b");
const previewThreads = [
  makeCardThread("one", "2026-10-04T12:00:00.000Z"),
  makeCardThread("two", "2026-10-03T12:00:00.000Z"),
  makeCardThread("three", "2026-10-02T12:00:00.000Z"),
  makeCardThread("four", "2026-10-01T12:00:00.000Z"),
  makeCardThread("five", "2026-09-30T12:00:00.000Z"),
];

beforeEach(() => {
  reactHookHarness.reset();
  preferenceState.states = {};
});

describe("project card ordering and previews", () => {
  it("sorts projects by their youngest thread and each project's rows newest first", () => {
    const oldest = makeCardThread("old", "2026-10-01T12:00:00.000Z");
    const middle = makeCardThread("middle", "2026-10-02T12:00:00.000Z");
    const newest = makeCardThread("new", "2026-10-04T09:00:00.000Z");
    const other = makeCardThread("other", "2026-10-04T11:59:00.000Z", "project-b");
    const cards = buildProjectCardGroups([projectA, projectB], [oldest, newest, other, middle]);
    expect(cards.map((card) => card.projectKey)).toEqual([
      projectB.projectKey,
      projectA.projectKey,
    ]);
    expect(cards[1]?.threads.map((thread) => thread.id)).toEqual(["new", "middle", "old"]);
  });

  it("uses the age-label fallback and ignores later agent-only updates", () => {
    const thread = { ...previewThreads[0]!, updatedAt: "2026-10-05T12:00:00.000Z" };
    expect(projectCardThreadTimestampMs(thread)).toBe(Date.parse(thread.latestUserMessageAt!));
    expect(projectCardThreadTimestampMs({ ...thread, latestUserMessageAt: null })).toBe(
      Date.parse(thread.updatedAt),
    );
    expect(projectCardThreadTimestampMs({ latestUserMessageAt: null, updatedAt: "invalid" })).toBe(
      0,
    );
  });

  it("keeps pinned rows in chronological position and never changes input order", () => {
    const rows = [
      { ...previewThreads[4]!, pinnedAt: "2026-10-04T12:00:00.000Z" },
      previewThreads[0]!,
    ];
    expect(buildProjectCardGroups([projectA], rows)[0]?.threads.map((thread) => thread.id)).toEqual(
      ["one", "five"],
    );
    expect(rows[0]?.id).toBe("five");
  });

  it("keeps same-id projects on separate environments distinct", () => {
    const remoteEnvironmentId = EnvironmentId.make("remote");
    const remoteProject = makeProjectCard("project-a", remoteEnvironmentId);
    const cards = buildProjectCardGroups(
      [projectA, remoteProject],
      [
        previewThreads[0]!,
        makeCardThread("one", "2026-10-04T12:00:00.000Z", "project-a", remoteEnvironmentId),
      ],
    );
    expect(cards).toHaveLength(2);
  });

  it("honors the app's logical project grouping across environments", () => {
    const remoteEnvironmentId = EnvironmentId.make("remote");
    const remoteProject = makeProjectCard("project-a", remoteEnvironmentId);
    const groupedProject = {
      ...projectA,
      memberProjects: [...projectA.memberProjects, ...remoteProject.memberProjects],
    };
    const cards = buildProjectCardGroups(
      [groupedProject],
      [
        previewThreads[0]!,
        makeCardThread("remote", "2026-10-03T12:00:00.000Z", "project-a", remoteEnvironmentId),
      ],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.threads).toHaveLength(2);
  });

  it("limits previews to three and adds an older selected row in chronological position", () => {
    expect(projectCardVisibleThreads(previewThreads, "preview", null, false)).toHaveLength(3);
    expect(
      projectCardVisibleThreads(
        previewThreads,
        "preview",
        projectCardThreadKey(previewThreads[4]!),
        true,
      ).map((thread) => thread.id),
    ).toEqual(["one", "two", "three", "five"]);
    expect(projectCardVisibleThreads(previewThreads, "expanded", null, false)).toHaveLength(5);
    expect(projectCardVisibleThreads(previewThreads, "collapsed", null, false)).toEqual([]);
  });

  it("uses stable tie-breaks for equal timestamps", () => {
    const rows = [previewThreads[0]!, { ...previewThreads[0]!, id: ThreadId.make("another") }];
    expect(buildProjectCardGroups([projectA], rows)[0]?.threads.map((thread) => thread.id)).toEqual(
      ["another", "one"],
    );
  });
});

describe("project card selection and saved state", () => {
  /** Simulate navigation while retaining hook state and the saved preference record. */
  function renderCards(selectedThreadKey: string | null) {
    reactHookHarness.beginRender();
    return useProjectCards({
      enabled: true,
      projects: [projectA],
      threads: previewThreads,
      selectedThreadKey,
      selectedDraftId: null,
      selectedDraftProjectKey: null,
    });
  }

  it("temporarily reveals a selected thread without saving expanded state", () => {
    const selected = projectCardThreadKey(previewThreads[4]!);
    expect(renderCards(selected).visibleThreads).toHaveLength(4);
    expect(preferenceState.states).toEqual({});
    expect(renderCards(null).visibleThreads).toHaveLength(3);
  });

  it("allows explicit collapse and restores temporary visibility on later navigation", () => {
    const selected = projectCardThreadKey(previewThreads[4]!);
    renderCards(selected).setCardState(projectA.projectKey, "collapsed");
    expect(renderCards(selected).visibleThreads).toHaveLength(0);
    renderCards(null);
    expect(renderCards(selected).visibleThreads).toHaveLength(4);
    expect(preferenceState.states[projectA.projectKey]).toBe("collapsed");
  });

  it("preserves expanded state across a sidebar remount and Show less restores three", () => {
    renderCards(null).setCardState(projectA.projectKey, "expanded");
    reactHookHarness.reset();
    expect(renderCards(null).visibleThreads).toHaveLength(5);
    renderCards(null).setCardState(projectA.projectKey, "preview");
    expect(renderCards(null).visibleThreads).toHaveLength(3);
  });
});

describe("shared project attention", () => {
  it("keeps unacknowledged wake signals visible and clears them through the existing watermark", () => {
    const thread = previewThreads[0]!;
    expect(
      resolveSidebarThreadAttention({
        thread,
        wokeAt: "2026-10-04T12:00:00.000Z",
        lastVisitedAt: undefined,
      }),
    ).toEqual({ isUnread: false, isWoke: true });
    expect(
      resolveSidebarThreadAttention({
        thread,
        wokeAt: "2026-10-04T12:00:00.000Z",
        lastVisitedAt: "2026-10-04T12:00:00.000Z",
      }),
    ).toEqual({ isUnread: false, isWoke: false });
  });

  it("does not light up never-visited historical completions", () => {
    const thread = {
      ...previewThreads[0]!,
      latestRun: {
        runId: RunId.make("unread-card-run"),
        status: "completed" as const,
        requestedAt: null,
        startedAt: null,
        completedAt: "2026-10-04T12:00:00.000Z",
        assistantMessageId: null,
      },
    };
    expect(
      resolveSidebarThreadAttention({ thread, wokeAt: null, lastVisitedAt: undefined }).isUnread,
    ).toBe(false);
    expect(
      resolveSidebarThreadAttention({
        thread,
        wokeAt: null,
        lastVisitedAt: "2026-10-03T12:00:00.000Z",
      }).isUnread,
    ).toBe(true);
  });
});
