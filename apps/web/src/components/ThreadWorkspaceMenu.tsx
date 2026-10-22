import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { create } from "zustand";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { requestConfirmDialog } from "../confirmDialog";
import { useNamedWorktreeStore, type NamedWorktreeSelection } from "../namedWorktreeStore";
import { readThreadShell, useProject, useQuietThreadShell } from "../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { vcsEnvironment } from "../state/vcs";
import { isWorktreeThreadRunning, type PreviousWorktreeSeed } from "./BranchToolbar.logic";
import { WorkspaceMenu, type WorkspaceMenuProps } from "./WorkspaceMenu";

interface WorkspacePickerRequest {
  readonly threadRef: ScopedThreadRef;
  readonly position: { readonly x: number; readonly y: number };
}

const useWorkspacePickerRequest = create<{ request: WorkspacePickerRequest | null }>(() => ({
  request: null,
}));

/** A queued turn or unanswered provider request still owns the thread's current checkout. */
function isThreadWorkspaceBusy(thread: EnvironmentThreadShell): boolean {
  return (
    isWorktreeThreadRunning({ status: thread.runtime?.status ?? "idle" }) ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput
  );
}

/** Open the existing picker for a context-menu target, without selecting another conversation. */
export function requestThreadWorkspaceEdit(request: WorkspacePickerRequest): void {
  useWorkspacePickerRequest.setState({ request });
}

/** Anchor native context-menu requests to their original sidebar or breadcrumb click. */
export function ThreadWorkspaceMenuHost() {
  const request = useWorkspacePickerRequest((state) => state.request);
  if (!request) return null;
  return (
    <ThreadWorkspaceMenu
      key={JSON.stringify(request)}
      threadRef={request.threadRef}
      open
      anchor={{ getBoundingClientRect: () => new DOMRect(request.position.x, request.position.y) }}
      onOpenChange={(open) => {
        if (!open && useWorkspacePickerRequest.getState().request === request) {
          useWorkspacePickerRequest.setState({ request: null });
        }
      }}
    />
  );
}

type ThreadWorkspaceMenuProps = Pick<
  WorkspaceMenuProps,
  "trigger" | "displayMode" | "open" | "onOpenChange" | "anchor" | "ariaLabel"
> & {
  readonly threadRef: ScopedThreadRef;
  readonly draftId?: DraftId;
};

/** Reuse normal Git commands and thread metadata updates for an idle thread's checkout choice. */
export function ThreadWorkspaceMenu({
  threadRef,
  draftId,
  ...menuProps
}: ThreadWorkspaceMenuProps) {
  const thread = useQuietThreadShell(threadRef);
  const draft = useComposerDraftStore((state) =>
    draftId ? state.getDraftSession(draftId) : state.getDraftThreadByRef(threadRef),
  );
  const projectRef = thread
    ? scopeProjectRef(thread.environmentId, thread.projectId)
    : draft
      ? scopeProjectRef(draft.environmentId, draft.projectId)
      : null;
  const project = useProject(projectRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const canCreate = useAtomValue(
    vcsEnvironment.createWorktree.permissionAtom(threadRef.environmentId),
  );
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [newWorktreeSelection, setNewWorktreeSelection] = useState<NamedWorktreeSelection | null>(
    null,
  );
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceContext = thread ?? draft;
  const activeWorktreePath = workspaceContext?.worktreePath ?? null;
  const activeBranch = workspaceContext?.branch ?? null;
  const running = thread !== null && isThreadWorkspaceBusy(thread);

  /** Recheck the target thread at execution, not only when its popup was rendered. */
  function canChangeWorkspace(): boolean {
    const currentThread = readThreadShell(threadRef);
    if (thread && !currentThread) return false;
    return (
      readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) &&
      !(
        currentThread &&
        (isThreadWorkspaceBusy(currentThread) ||
          currentThread.worktreePath !== activeWorktreePath ||
          currentThread.branch !== activeBranch)
      )
    );
  }

  /** Keep one thread's workspace update conditional on the branch and path originally selected. */
  async function assignWorkspace(seed: PreviousWorktreeSeed): Promise<void> {
    if (!project || !projectRef) throw new Error("The thread's project is unavailable.");
    const worktreePath = seed.worktreePath === project.workspaceRoot ? null : seed.worktreePath;
    if (thread) {
      const updated = await updateMetadata({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          branch: seed.branch,
          worktreePath,
          expectedWorktreePath: activeWorktreePath,
          expectedBranch: activeBranch,
          expectedIdle: true,
        },
      });
      if (updated._tag === "Failure") throw squashAtomCommandFailure(updated);
    } else if (draft) {
      useComposerDraftStore.getState().setDraftThreadContext(draftId ?? threadRef, {
        branch: seed.branch,
        worktreePath,
        envMode: worktreePath ? "worktree" : "local",
        projectRef,
        environmentSelection: "manual",
      });
    } else {
      throw new Error("The thread is no longer available.");
    }
    useNamedWorktreeStore.getState().select(projectRef, threadRef.threadId, null);
  }

  /** Hide the picker while confirming, then recheck the thread before any mutation. */
  async function confirmWorkspaceMove(message: string): Promise<boolean> {
    setConfirming(true);
    const confirmed = await requestConfirmDialog(
      `${message}\n\nFiles and uncommitted changes will stay in the current checkout. They will not be transferred.`,
      { confirmLabel: "Proceed" },
    );
    return Boolean(confirmed) && canChangeWorkspace();
  }

  /** Leave cancellations and failures in the picker and prevent duplicate operations. */
  async function changeWorkspace(change: () => Promise<boolean>): Promise<boolean> {
    if (pendingRef.current || !canChangeWorkspace()) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    let changed = false;
    try {
      changed = await change();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(detail);
    }
    setConfirming(false);
    pendingRef.current = false;
    setPending(false);
    return changed;
  }

  /** Adopt the branch actually checked out at the destination, including detached HEAD. */
  async function selectWorktree(seed: PreviousWorktreeSeed): Promise<boolean> {
    return changeWorkspace(async () => {
      const status = await refreshStatus({
        environmentId: threadRef.environmentId,
        input: { cwd: seed.worktreePath },
      });
      if (status._tag === "Failure") throw squashAtomCommandFailure(status);
      if (!status.value.isRepo)
        throw new Error("This workspace is unavailable. Choose another checkout.");
      const currentCheckoutPath = activeWorktreePath ?? project?.workspaceRoot;
      if (
        seed.worktreePath !== currentCheckoutPath &&
        !(await confirmWorkspaceMove(
          `Move this thread to the selected checkout?\n${seed.worktreePath}`,
        ))
      )
        return false;
      await assignWorkspace({ worktreePath: seed.worktreePath, branch: status.value.refName });
      return true;
    });
  }

  /** Workspace edits require an explicit name shared by the new checkout and branch. */
  async function createAndUseWorktree(selection: NamedWorktreeSelection | null): Promise<boolean> {
    return changeWorkspace(async () => {
      if (!project || !projectRef || !canCreate)
        throw new Error("This connection cannot create worktrees.");
      if (!selection?.name.trim())
        throw new Error("Enter a worktree name before creating a workspace.");
      if (!activeBranch)
        throw new Error("The thread has no source branch. Choose an existing workspace.");
      setNewWorktreeSelection(selection);
      const branch = selection.name.trim();
      if (
        !(await confirmWorkspaceMove(
          `Create a worktree and move this thread?\nThis will create worktree "${branch}" from branch "${activeBranch}" and move this thread to it.`,
        ))
      )
        return false;
      const created = await createWorktree({
        environmentId: threadRef.environmentId,
        input: {
          cwd: project.workspaceRoot,
          refName: activeBranch,
          baseRefName: activeBranch,
          newRefName: branch,
          directoryName: branch,
          path: null,
        },
      });
      if (created._tag === "Failure") throw squashAtomCommandFailure(created);
      const worktree = created.value.worktree;
      useNamedWorktreeStore.getState().setColor(projectRef, worktree.path, selection.color);
      try {
        await assignWorkspace({ worktreePath: worktree.path, branch: worktree.refName });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Created ${branch}, but could not move the thread. Select it from the worktree list to retry. ${detail}`,
          { cause },
        );
      }
      return true;
    });
  }

  if (!project || !projectRef || (!thread && !draft)) return null;
  const hint =
    error ??
    (pending
      ? "Updating workspace..."
      : running
        ? "Stop this thread before changing its workspace."
        : !canOperate
          ? "This connection cannot change the thread's workspace."
          : null);
  return (
    <WorkspaceMenu
      {...menuProps}
      {...(confirming ? { open: false } : {})}
      onOpenChange={(open) => {
        if (confirming) return;
        if (!open) setNewWorktreeSelection(null);
        menuProps.onOpenChange?.(open);
      }}
      environmentId={threadRef.environmentId}
      projectRef={projectRef}
      projectCwd={project.workspaceRoot}
      activeWorktreePath={activeWorktreePath}
      activeBranch={activeBranch}
      effectiveEnvMode={activeWorktreePath ? "worktree" : "local"}
      envLocked={pending || running || !canOperate}
      allowOpenWhenLocked
      canUseWorktree={!pending && !running && canOperate}
      canCreateWorktree={canCreate}
      requireWorktreeName
      namedWorktreeSelection={newWorktreeSelection}
      interactionMode="standalone"
      selectionHint={hint}
      onEnvModeChange={() => selectWorktree({ worktreePath: project.workspaceRoot, branch: null })}
      onNewWorktreeSelect={createAndUseWorktree}
      onUseWorktree={selectWorktree}
    />
  );
}
