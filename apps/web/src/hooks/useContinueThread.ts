import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ThreadTag } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import {
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../composerDraftStore";
import { useDraftTagStore } from "../draftTagStore";
import { newDraftId, newThreadId } from "../lib/utils";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { readProjects, readThreadShell } from "../state/entities";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadTagsSupported, threadTagEnvironment } from "../state/threadTags";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings } from "./useSettings";

/** Create an empty draft with the source's settings, without a conversation or provider-session link. */
export function createContinuedThreadDraft(input: {
  readonly source: EnvironmentThreadShell | DraftSessionState;
  readonly composer: ComposerThreadDraftState | null;
  readonly logicalProjectKey: string;
  readonly tag: ThreadTag | null;
}) {
  const { source, composer, logicalProjectKey, tag } = input;
  const draftId = newDraftId();
  const threadId = newThreadId();
  const drafts = useComposerDraftStore.getState();
  const selectedProvider = composer?.activeProvider;
  const composerSelection = selectedProvider
    ? composer?.modelSelectionByProvider[selectedProvider]
    : null;
  const modelSelection =
    composerSelection ?? ("modelSelection" in source ? source.modelSelection : null);
  const runtimeMode = composer?.runtimeMode ?? source.runtimeMode;
  const interactionMode = composer?.interactionMode ?? source.interactionMode;
  const envMode = "envMode" in source ? source.envMode : source.worktreePath ? "worktree" : "local";

  drafts.setLogicalProjectDraftThreadId(
    logicalProjectKey,
    scopeProjectRef(source.environmentId, source.projectId),
    draftId,
    {
      threadId,
      sourceThreadRef: null,
      createdAt: new Date().toISOString(),
      branch: source.branch,
      worktreePath: source.worktreePath,
      envMode,
      startFromOrigin: "startFromOrigin" in source ? source.startFromOrigin : false,
      runtimeMode,
      interactionMode,
      // A server thread ran on this machine. Continue must retain that destination,
      // especially when its worktree path is meaningful only on that machine.
      environmentSelection:
        "environmentSelection" in source ? source.environmentSelection : "manual",
    },
  );
  if (modelSelection) {
    drafts.setModelSelection(draftId, modelSelection, { replaceOptions: true, explicit: true });
  }
  drafts.setRuntimeMode(draftId, runtimeMode);
  drafts.setInteractionMode(draftId, interactionMode);
  useDraftTagStore.getState().select(draftId, tag);
  return { draftId, threadId };
}

/** Continue the current route's settings only after its server tag snapshot is available. */
export function useContinueThread() {
  const router = useRouter();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const sourceEnvironmentId =
    routeTarget?.kind === "server" ? routeTarget.threadRef.environmentId : null;
  const tagSnapshotAtom = useMemo(
    () =>
      sourceEnvironmentId
        ? threadTagEnvironment.snapshotAtom(sourceEnvironmentId)
        : Atom.make(null),
    [sourceEnvironmentId],
  );
  // Lease the current thread's tag snapshot while this action is available.
  // Reading an unmounted subscription at click time could mistake loading for no tag.
  useAtomValue(tagSnapshotAtom);

  const handleContinueThread = useCallback(async () => {
    try {
      const currentTarget = resolveThreadRouteTarget(
        router.state.matches[router.state.matches.length - 1]?.params ?? {},
      );
      if (!currentTarget) return;
      const drafts = useComposerDraftStore.getState();
      const source =
        currentTarget.kind === "server"
          ? readThreadShell(currentTarget.threadRef)
          : drafts.getDraftSession(currentTarget.draftId);
      if (!source) return;
      const sourceProject = readProjects().find(
        (project) =>
          project.environmentId === source.environmentId && project.id === source.projectId,
      );
      if (!sourceProject) return;
      let tag: ThreadTag | null = null;
      if (currentTarget.kind === "draft") {
        tag = useDraftTagStore.getState().byDraftId[currentTarget.draftId] ?? null;
      } else if (readThreadTagsSupported(source.environmentId)) {
        const snapshot = appAtomRegistry.get(
          threadTagEnvironment.snapshotAtom(source.environmentId),
        );
        if (snapshot === null) {
          throw new Error("Thread tags are unavailable. Wait for the connection, then try again.");
        }
        tag = snapshot[currentTarget.threadRef.threadId] ?? null;
      }
      const continued = createContinuedThreadDraft({
        source,
        composer: drafts.getComposerDraft(
          currentTarget.kind === "server" ? currentTarget.threadRef : currentTarget.draftId,
        ),
        logicalProjectKey: deriveLogicalProjectKeyFromSettings(sourceProject, groupingSettings),
        tag,
      });
      await router.navigate({ to: "/draft/$draftId", params: { draftId: continued.draftId } });
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not continue thread",
          description: error instanceof Error ? error.message : "Could not open a new draft.",
        }),
      );
    }
  }, [groupingSettings, router]);

  return { canContinueThread: routeTarget !== null, handleContinueThread };
}
