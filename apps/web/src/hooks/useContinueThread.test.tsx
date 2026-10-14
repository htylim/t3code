import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ProviderInstanceId, type ThreadTags } from "@t3tools/contracts";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useDraftTagStore } from "../draftTagStore";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { makeThreadFixture } from "../test-fixtures";

const state = vi.hoisted(() => ({
  thread: null as EnvironmentThreadShell | null,
  params: {} as Record<string, string>,
  snapshot: {} as ThreadTags | null,
  supported: true,
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select(state.params),
  useRouter: () => ({
    state: { matches: [{ params: state.params }] },
    navigate: state.navigate,
  }),
}));
vi.mock("./useSettings", () => ({
  useClientSettings: () => ({ sidebarProjectGroupingMode: "repository" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => state.thread,
  readProjects: () =>
    state.thread
      ? [
          {
            id: state.thread.projectId,
            environmentId: state.thread.environmentId,
            workspaceRoot: "/repo",
            repositoryIdentity: null,
          },
        ]
      : [],
}));
vi.mock("../state/threadTags", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    readThreadTagsSupported: () => state.supported,
    threadTagEnvironment: { snapshotAtom: () => Atom.make(state.snapshot) },
  };
});
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: state.toast },
}));

import { createContinuedThreadDraft, useContinueThread } from "./useContinueThread";

const tag = { label: "Backend", color: "#8b5cf6" };
const sourceThread = makeThreadFixture({
  branch: "feature/source",
  worktreePath: "/repo-worktree",
  runtimeMode: "approval-required",
  interactionMode: "plan",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex_personal"),
    model: "gpt-5.6-terra",
    options: [{ id: "reasoningEffort", value: "low" }],
  },
});
const sourceRef = scopeThreadRef(sourceThread.environmentId, sourceThread.id);
let renderer: ReactTestRenderer | undefined;
let continueThread: ReturnType<typeof useContinueThread>;

/** Mount the actual action hook using the real composer and draft-tag stores. */
function Harness() {
  const action = useContinueThread();
  useEffect(() => {
    continueThread = action;
  }, [action]);
  return null;
}

/** Start each case with isolated in-memory draft selections and route state. */
beforeEach(() => {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  useDraftTagStore.setState({ byDraftId: {}, pendingByThreadKey: {} });
  state.thread = sourceThread;
  state.params = { environmentId: sourceThread.environmentId, threadId: sourceThread.id };
  state.snapshot = { [sourceThread.id]: tag };
  state.supported = true;
  state.navigate.mockReset();
  state.toast.mockReset();
});

/** Release the tag subscription and rendered hook after each case. */
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe("createContinuedThreadDraft", () => {
  it("copies provider options, worktree, modes, and tag into a fresh unlinked draft", () => {
    const continued = createContinuedThreadDraft({
      source: sourceThread,
      composer: null,
      logicalProjectKey: "repo",
      tag,
    });
    const drafts = useComposerDraftStore.getState();
    expect(continued.threadId).not.toBe(sourceThread.id);
    expect(drafts.getDraftSession(continued.draftId)).toMatchObject({
      environmentId: sourceThread.environmentId,
      projectId: sourceThread.projectId,
      branch: sourceThread.branch,
      worktreePath: sourceThread.worktreePath,
      envMode: "worktree",
      startFromOrigin: false,
      environmentSelection: "manual",
      runtimeMode: "approval-required",
      interactionMode: "plan",
      sourceThreadRef: null,
      promotedTo: null,
    });
    expect(drafts.getComposerDraft(continued.draftId)).toMatchObject({
      prompt: "",
      images: [],
      files: [],
      threadContexts: [],
      terminalContexts: [],
      previewAnnotations: [],
      reviewComments: [],
      modelSelectionExplicit: true,
      modelSelectionByProvider: { codex_personal: sourceThread.modelSelection },
    });
    expect(useDraftTagStore.getState().byDraftId[continued.draftId]).toEqual(tag);
  });

  it("copies the visible composer overrides without copying unsent content", () => {
    const drafts = useComposerDraftStore.getState();
    const selection = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-4-6",
      options: [{ id: "effort", value: "medium" }],
    };
    drafts.setModelSelection(sourceRef, selection, { explicit: true });
    drafts.setRuntimeMode(sourceRef, "full-access");
    drafts.setInteractionMode(sourceRef, "default");
    drafts.setPrompt(sourceRef, "Unsent source prompt");
    const composer = drafts.getComposerDraft(sourceRef);
    const continued = createContinuedThreadDraft({
      source: sourceThread,
      composer,
      logicalProjectKey: "repo",
      tag: null,
    });
    expect(drafts.getComposerDraft(continued.draftId)).toMatchObject({
      prompt: "",
      activeProvider: "claudeAgent",
      modelSelectionByProvider: { claudeAgent: selection },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
    expect(drafts.getComposerDraft(sourceRef)).toEqual(composer);
    expect(useDraftTagStore.getState().byDraftId[continued.draftId]).toBeUndefined();
  });

  it("preserves an invested draft and carries its pending workspace settings to a distinct draft", () => {
    const drafts = useComposerDraftStore.getState();
    const sourceId = DraftId.make("invested-draft");
    drafts.setLogicalProjectDraftThreadId(
      "repo",
      { environmentId: sourceThread.environmentId, projectId: sourceThread.projectId },
      sourceId,
      {
        branch: "main",
        worktreePath: null,
        envMode: "worktree",
        startFromOrigin: true,
        environmentSelection: "auto",
      },
    );
    drafts.setPrompt(sourceId, "Keep this unsent work");
    drafts.setModelSelection(sourceId, sourceThread.modelSelection);
    useDraftTagStore.getState().select(sourceId, tag);
    const source = drafts.getDraftSession(sourceId)!;
    const continued = createContinuedThreadDraft({
      source,
      composer: drafts.getComposerDraft(sourceId),
      logicalProjectKey: "repo",
      tag,
    });
    expect(continued.draftId).not.toBe(sourceId);
    expect(drafts.getDraftSession(sourceId)).toEqual(source);
    expect(drafts.getComposerDraft(sourceId)?.prompt).toBe("Keep this unsent work");
    expect(drafts.getDraftSession(continued.draftId)).toMatchObject({
      branch: "main",
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
      environmentSelection: "auto",
      sourceThreadRef: null,
    });
    expect(drafts.getComposerDraft(continued.draftId)?.prompt).toBe("");
    expect(useDraftTagStore.getState().byDraftId[sourceId]).toEqual(tag);
  });
});

describe("useContinueThread", () => {
  it("reads the current thread tag and navigates to a new draft in the same environment", async () => {
    await act(async () => {
      renderer = create(
        <AppAtomRegistryProvider>
          <Harness />
        </AppAtomRegistryProvider>,
      );
    });
    await act(async () => continueThread.handleContinueThread());
    const draftId = state.navigate.mock.calls[0]![0].params.draftId as DraftId;
    expect(useComposerDraftStore.getState().getDraftSession(draftId)?.environmentId).toBe(
      sourceThread.environmentId,
    );
    expect(useDraftTagStore.getState().byDraftId[draftId]).toEqual(tag);
    expect(state.toast).not.toHaveBeenCalled();
  });

  it("does not create an incorrectly untagged draft while the source tag is unavailable", async () => {
    state.snapshot = null;
    await act(async () => {
      renderer = create(
        <AppAtomRegistryProvider>
          <Harness />
        </AppAtomRegistryProvider>,
      );
    });
    await act(async () => continueThread.handleContinueThread());
    expect(state.navigate).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().draftThreadsByThreadKey).toEqual({});
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not continue thread" }),
    );
  });

  it("continues without a tag on an upstream server that does not support tags", async () => {
    state.supported = false;
    state.snapshot = null;
    await act(async () => {
      renderer = create(
        <AppAtomRegistryProvider>
          <Harness />
        </AppAtomRegistryProvider>,
      );
    });
    await act(async () => continueThread.handleContinueThread());
    expect(state.navigate).toHaveBeenCalledOnce();
    expect(useDraftTagStore.getState().byDraftId).toEqual({});
  });
});
