import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";

import { buildComposerThreadPickerItems } from "./composerThreadPicker";
import { detectComposerTrigger, replaceTextRange } from "./composer-logic";
import {
  buildMessageContext,
  threadContextRecord,
  threadContextReference,
} from "./lib/composerContextRecords";
import { formatInlineContextReference } from "./lib/composerContextReferences";
import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";

const environmentId = EnvironmentId.make("local");
const otherEnvironmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("app");
const otherProjectId = ProjectId.make("docs");
const projects = [
  { environmentId, id: projectId, title: "Application" },
  { environmentId, id: otherProjectId, title: "Documentation" },
  { environmentId: otherEnvironmentId, id: projectId, title: "Foreign project" },
];

/** Build only the shell fields consumed by the picker. */
function shell(
  id: string,
  overrides: Partial<Parameters<typeof buildComposerThreadPickerItems>[0]["shells"][number]> = {},
) {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: "Fix login flow",
    branch: "feature/login",
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    latestUserMessageAt: null,
    ...overrides,
  };
}

const pickerInput = {
  projects,
  environmentId,
  projectId,
  excludeThreadId: ThreadId.make("self"),
  scope: "project" as const,
  query: "",
};

describe("composer thread picker", () => {
  const shells = [
    shell("current-project"),
    shell("other-project", { projectId: otherProjectId }),
    shell("self"),
    shell("archived", { archivedAt: "2026-10-02T00:00:00.000Z" }),
    shell("foreign", { environmentId: otherEnvironmentId }),
  ];

  it("browses the composing project with no query, excluding self, archives, and other servers", () => {
    const items = buildComposerThreadPickerItems({ ...pickerInput, shells });
    expect(items.map((item) => item.thread.threadId)).toEqual(["current-project"]);
    expect(items[0]).toEqual({
      id: "thread:local:current-project",
      type: "thread",
      thread: { environmentId, threadId: "current-project" },
      label: "Fix login flow",
      description: "Application #feature/login",
    });
  });

  it("browses all projects in the same environment with %%", () => {
    const items = buildComposerThreadPickerItems({ ...pickerInput, shells, scope: "environment" });
    expect(items.map((item) => item.thread.threadId)).toEqual(["current-project", "other-project"]);
    expect(items[1]?.description).toBe("Documentation #feature/login");
  });

  it("follows a draft or side chat's composing project instead of the main chat project", () => {
    const items = buildComposerThreadPickerItems({
      ...pickerInput,
      shells,
      projectId: otherProjectId,
    });
    expect(items.map((item) => item.thread.threadId)).toEqual(["other-project"]);
  });

  it("requires a selected project for %, while %% can browse without one", () => {
    expect(buildComposerThreadPickerItems({ ...pickerInput, shells, projectId: null })).toEqual([]);
    expect(
      buildComposerThreadPickerItems({
        ...pickerInput,
        shells,
        projectId: null,
        scope: "environment",
      }),
    ).toHaveLength(2);
  });

  it.each(["  LOGIN FLOW  ", "application", "feature/login", "current-project"])(
    "searches titles, project names, branches, and IDs with %s",
    (query) => {
      expect(buildComposerThreadPickerItems({ ...pickerInput, shells, query })).toHaveLength(1);
    },
  );

  it("sorts by latest user activity, with creation time as fallback and stable ties", () => {
    const items = buildComposerThreadPickerItems({
      ...pickerInput,
      shells: [
        shell("old"),
        shell("recent-user", { latestUserMessageAt: "2026-10-04T00:00:00.000Z" }),
        shell("new-b", { createdAt: "2026-10-03T00:00:00.000Z" }),
        shell("new-a", { createdAt: "2026-10-03T00:00:00.000Z" }),
      ],
    });
    expect(items.map((item) => item.thread.threadId)).toEqual([
      "recent-user",
      "new-a",
      "new-b",
      "old",
    ]);
  });

  it("caps the menu at 20 and keeps untitled-project fallback readable", () => {
    const items = buildComposerThreadPickerItems({
      ...pickerInput,
      projects: [],
      shells: Array.from({ length: 40 }, (_, index) => shell(`thread-${index}`, { branch: null })),
    });
    expect(items).toHaveLength(20);
    expect(items[0]?.description).toBe(projectId);
  });

  it("returns nothing when no thread matches", () => {
    expect(
      buildComposerThreadPickerItems({ ...pickerInput, shells, query: "does not exist" }),
    ).toEqual([]);
  });

  it("replaces a multiword query with an upstream chip and passes the thread identity to the provider", () => {
    const prompt = "Compare with %%login flow";
    const trigger = detectComposerTrigger(prompt, prompt.length)!;
    const [selected] = buildComposerThreadPickerItems({
      ...pickerInput,
      shells: [shell("other-project", { projectId: otherProjectId })],
      scope: trigger.threadScope!,
      query: trigger.query,
    });
    const record = threadContextRecord(selected!.thread, selected!.label);
    const replacement = `${formatInlineContextReference(threadContextReference(record))} `;
    const edited = replaceTextRange(prompt, trigger.rangeStart, trigger.rangeEnd, replacement);
    expect(edited.text).toBe(
      `Compare with [Fix login flow](t3-context://v1/thread/${record.contextId}) `,
    );
    expect(detectComposerTrigger(edited.text, edited.cursor)).toBeNull();
    expect(splitPromptIntoComposerSegments(edited.text)).toContainEqual({
      type: "context-reference",
      kind: "thread",
      contextId: record.contextId,
      label: "Fix login flow",
      source: replacement.trimEnd(),
    });
    const context = buildMessageContext({
      terminalContexts: [],
      reviewComments: [],
      previewAnnotations: [],
      threadContexts: [record],
    });
    const providerInput = projectComposerContextForProvider({
      text: edited.text,
      records: context!.records,
    });
    expect(providerInput).toContain("threadId: other-project");
    expect(providerInput).toContain("environmentId: local");
    expect(providerInput).toContain("t3_thread_read(threadId)");
  });
});
