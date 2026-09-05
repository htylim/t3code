import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadReferenceItems,
  collectThreadReferenceMarkdownTokens,
  parseThreadReferenceUri,
  serializeThreadReferenceMarkdown,
  serializeThreadReferenceUri,
  THREAD_REFERENCE_RESULT_LIMIT,
} from "./threadReference";

const environmentId = EnvironmentId.make("local/environment");
const otherEnvironmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-1");

function project(
  id = projectId,
  title = "T3 Code",
  environment = environmentId,
): EnvironmentProject {
  return {
    environmentId: environment,
    id,
    title,
    workspaceRoot: "/workspace/t3code",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function thread(id: string, options: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: `Thread ${id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...options,
  };
}

describe("thread picker project scope and recency", () => {
  const otherProjectId = ProjectId.make("project-2");
  const threads = [
    thread("renamed", { updatedAt: "2026-09-05T00:00:00.000Z" }),
    thread("recent", { latestUserMessageAt: "2026-09-04T00:00:00.000Z" }),
    thread("other", { projectId: otherProjectId, latestUserMessageAt: "2026-09-05T00:00:00.000Z" }),
    thread("other-older", {
      projectId: otherProjectId,
      latestUserMessageAt: "2026-08-02T00:00:00.000Z",
    }),
    thread("new", { createdAt: "2026-09-03T00:00:00.000Z" }),
    thread("foreign", {
      environmentId: otherEnvironmentId,
      latestUserMessageAt: "2026-09-05T00:00:00.000Z",
    }),
    thread("archived", { archivedAt: "2026-09-05T00:00:00.000Z" }),
  ];
  const options = {
    environmentId,
    currentThreadId: null,
    query: "",
    threads,
    projects: [project()],
    projectId,
  };

  it("shows only the composing project, using user activity and creation instead of metadata updates", () => {
    expect(
      buildThreadReferenceItems({ ...options, scope: "project" }).map(
        (item) => item.threadRef.threadId,
      ),
    ).toEqual(["recent", "new", "renamed"]);
  });

  it("interleaves all projects by recency in environment scope", () => {
    expect(
      buildThreadReferenceItems({ ...options, scope: "environment" }).map(
        (item) => item.threadRef.threadId,
      ),
    ).toEqual(["other", "recent", "new", "other-older", "renamed"]);
  });

  it("does not broaden a draft with no selected project, but still allows explicit environment search", () => {
    expect(buildThreadReferenceItems({ ...options, projectId: null, scope: "project" })).toEqual(
      [],
    );
    expect(
      buildThreadReferenceItems({ ...options, projectId: null, scope: "environment" }),
    ).toHaveLength(5);
  });

  it("filters the project before applying the result cap", () => {
    const busyOtherProject = Array.from({ length: 25 }, (_, index) =>
      thread(`other-${index}`, {
        projectId: otherProjectId,
        latestUserMessageAt: "2026-09-05T00:00:00.000Z",
      }),
    );
    expect(
      buildThreadReferenceItems({
        ...options,
        scope: "project",
        threads: [...busyOtherProject, thread("local")],
      }).map((item) => item.threadRef.threadId),
    ).toEqual(["local"]);
  });
});

describe("thread reference URI", () => {
  it("serializes escaped Markdown and round-trips encoded scoped IDs", () => {
    const threadRef = {
      environmentId,
      threadId: ThreadId.make("thread/with spaces"),
    };
    const uri = "t3code://threads/local%2Fenvironment/thread%2Fwith%20spaces";

    expect(serializeThreadReferenceUri(threadRef)).toBe(uri);
    expect(parseThreadReferenceUri(uri)).toEqual(threadRef);
    expect(serializeThreadReferenceMarkdown("Fix [copy] \\ now", threadRef)).toBe(
      `[Fix \\[copy\\] \\\\ now](${uri})`,
    );
  });

  it.each([
    "https://threads/local/thread-1",
    "t3code://other/local/thread-1",
    "t3code://user@threads/local/thread-1",
    "t3code://threads:99/local/thread-1",
    "t3code://threads/local/thread-1/extra",
    "t3code://threads//thread-1",
    "t3code://threads/local/",
    "t3code://threads/local/thread-1?view=full",
    "t3code://threads/local/thread-1#turn",
    "t3code://threads/local/%ZZ",
    "t3code://threads/%65nv/thread-1",
    "t3code://threads/local/%74hread-1",
    "t3code://threads/local/..",
    "t3code://threads/local/%2E%2E",
    "t3code://threads/%20/thread-1",
    "t3code://threads/local/%20",
  ])("rejects non-canonical destination %s", (destination) => {
    expect(parseThreadReferenceUri(destination)).toBeNull();
  });
});

describe("thread reference Markdown", () => {
  it("collects canonical references with escaped labels and exact source offsets", () => {
    const source = serializeThreadReferenceMarkdown("Fix [copy] \\ now", {
      environmentId,
      threadId: ThreadId.make("thread/with spaces"),
    });
    const prompt = `Compare ${source} next`;

    expect(collectThreadReferenceMarkdownTokens(prompt)).toEqual([
      {
        threadRef: {
          environmentId,
          threadId: ThreadId.make("thread/with spaces"),
        },
        label: "Fix [copy] \\ now",
        source,
        start: "Compare ".length,
        end: "Compare ".length + source.length,
      },
    ]);
  });

  it.each([
    "[Web](https://example.com)",
    "[Extra](t3code://threads/local/thread-1/extra)",
    "[Query](t3code://threads/local/thread-1?view=full)",
    "[Noncanonical \\* label](t3code://threads/local/thread-1)",
  ])("leaves non-canonical reference %s as text", (source) => {
    expect(collectThreadReferenceMarkdownTokens(source)).toEqual([]);
  });
});

describe("buildThreadReferenceItems", () => {
  it("scopes, excludes archived/current threads, sorts, and snapshots labels", () => {
    const currentThreadId = ThreadId.make("current");
    const items = buildThreadReferenceItems({
      projectId,
      scope: "environment",
      environmentId,
      currentThreadId,
      query: "",
      projects: [project(), project(ProjectId.make("other-project"), "Other", otherEnvironmentId)],
      threads: [
        thread("older", { title: "Older", latestUserMessageAt: "2026-08-01T10:00:00.000Z" }),
        thread("b", {
          title: "Beta",
          branch: "feature/picker",
          latestUserMessageAt: "2026-08-02T10:00:00.000Z",
        }),
        thread("a", { title: "Alpha", latestUserMessageAt: "2026-08-02T10:00:00.000Z" }),
        thread("archived", { archivedAt: "2026-08-03T00:00:00.000Z" }),
        thread("current"),
        thread("remote", { environmentId: otherEnvironmentId }),
      ],
    });

    expect(items.map((item) => item.label)).toEqual(["Alpha", "Beta", "Older"]);
    expect(items[1]?.description).toBe("T3 Code #feature/picker");
    expect(serializeThreadReferenceMarkdown(items[0]!.label, items[0]!.threadRef)).toContain(
      "[Alpha]",
    );
  });

  it.each([
    ["release", "Release checklist"],
    ["needle-id", "By id"],
    ["docs project", "By project"],
    ["feature/needle", "By branch"],
  ])("searches %s across the fixed metadata", (query, expectedTitle) => {
    const docsProjectId = ProjectId.make("docs-project-id");
    const items = buildThreadReferenceItems({
      projectId,
      scope: "environment",
      environmentId,
      currentThreadId: null,
      query,
      projects: [project(), project(docsProjectId, "Docs Project")],
      threads: [
        thread("title", { title: "Release checklist" }),
        thread("needle-id", { title: "By id" }),
        thread("project", { title: "By project", projectId: docsProjectId }),
        thread("branch", { title: "By branch", branch: "feature/needle" }),
      ],
    });

    expect(items.map((item) => item.label)).toEqual([expectedTitle]);
  });

  it("caps results and falls back to the project ID when its shell is absent", () => {
    const threads = Array.from({ length: THREAD_REFERENCE_RESULT_LIMIT + 5 }, (_, index) =>
      thread(`thread-${String(index).padStart(2, "0")}`, {
        projectId: ProjectId.make("missing-project"),
        latestUserMessageAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const items = buildThreadReferenceItems({
      projectId,
      scope: "environment",
      environmentId,
      currentThreadId: null,
      query: "",
      projects: [],
      threads,
    });

    expect(items).toHaveLength(THREAD_REFERENCE_RESULT_LIMIT);
    expect(items[0]?.description).toBe("missing-project");
    expect(items[0]?.threadRef.threadId).toBe("thread-24");
  });
});
