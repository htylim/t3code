import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
  createVcsStatusRevalidationAtomFamily,
} from "@t3tools/client-runtime/state/vcs";

import { connectionAtomRuntime } from "../connection/runtime";
import { subscribeDocumentReturn } from "../lib/documentActivity";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, ProjectId, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
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

/**
 * Refreshes a checkout's status when the user comes back to the window, where
 * edits made in another app or terminal may be waiting.
 */
export const vcsStatusRevalidation = createVcsStatusRevalidationAtomFamily({
  refreshStatus: vcsEnvironment.refreshStatus,
  subscribeWake: subscribeDocumentReturn,
  wakeDebounceMs: 250,
});
