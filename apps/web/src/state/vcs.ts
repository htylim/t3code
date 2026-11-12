import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
  createVcsStatusRevalidationAtomFamily,
} from "@t3tools/client-runtime/state/vcs";
import * as Equal from "effect/Equal";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { subscribeDocumentReturn } from "../lib/documentActivity";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, ProjectId, type EnvironmentId } from "@t3tools/contracts";
import { serverEnvironment } from "./server";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";

const worktreeCleanupSettingsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (!settings) return null;
    return JSON.stringify([
      resolveWorktreeCleanup(settings, null),
      Object.keys(settings.projectSettingsOverrides).map((projectId) => [
        projectId,
        resolveWorktreeCleanup(settings, ProjectId.make(projectId)),
      ]),
    ]);
  }),
);

export const vcsEnvironment = {
  ...createVcsEnvironmentAtoms(connectionAtomRuntime),
  workspaceColors: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:workspace:colors",
    tag: WS_METHODS.workspaceColorsSubscribe,
    idleTtlMs: 0,
  }),
  worktreeCleanupProgress: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "environment-data:fork:worktree-cleanup-progress",
    tag: WS_METHODS.forkWorktreeCleanupProgress,
    idleTtlMs: 0,
  }),
  worktreeCleanupStatus: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "environment-data:fork:worktree-cleanup-status",
    tag: WS_METHODS.forkWorktreeCleanupStatus,
    staleTimeMs: 0,
    idleTtlMs: 0,
    refreshIntervalMs: 30_000,
    refreshTrigger: ({ environmentId }) => worktreeCleanupSettingsAtom(environmentId),
  }),
};
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);

/** Only what a chat view reads, so changing file counts don't re-render it on every edit. */
export const chatGitStatusAtom = Atom.family((status: ReturnType<typeof vcsEnvironment.status>) =>
  Atom.map(status, (result) => {
    const data = AsyncResult.getOrElse(result, () => null);
    if (data === null) return null;
    const { isRepo, refName, hasWorkingTreeChanges, pr } = data;
    return { isRepo, refName, hasWorkingTreeChanges, pr };
  }).pipe(Atom.withEquality(Equal.equals)),
);
export const NO_CHAT_GIT_STATUS_ATOM: ReturnType<typeof chatGitStatusAtom> = Atom.make(null);

/**
 * Refreshes a checkout's status when the user comes back to the window, where
 * edits made in another app or terminal may be waiting.
 */
export const vcsStatusRevalidation = createVcsStatusRevalidationAtomFamily({
  refreshStatus: vcsEnvironment.refreshStatus,
  subscribeWake: subscribeDocumentReturn,
  wakeDebounceMs: 250,
});

export const vcsBranchRevalidation = createVcsStatusRevalidationAtomFamily({
  refreshStatus: vcsEnvironment.refreshBranch,
  subscribeWake: subscribeDocumentReturn,
  wakeDebounceMs: 250,
});
