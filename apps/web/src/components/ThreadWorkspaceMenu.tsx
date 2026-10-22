import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { create } from "zustand";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useNamedWorktreeStore, type NamedWorktreeSelection } from "../namedWorktreeStore";
import { readThreadShell, useProject, useQuietThreadShell } from "../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { vcsEnvironment } from "../state/vcs";
import { isWorktreeThreadRunning, type PreviousWorktreeSeed } from "./BranchToolbar.logic";
import type { WorkspaceMenuProps } from "./WorkspaceMenu";
import { WorkspaceChangeDialog } from "./WorkspaceChangeDialog";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";

interface WorkspacePickerRequest {
  readonly threadRef: ScopedThreadRef;
  readonly position: { readonly x: number; readonly y: number };
  /** Return keyboard users to their trigger without refocusing pointer-opened pills. */
  readonly returnFocus?: HTMLElement | false | undefined;
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

/** Open workspace changes for a context-menu target without selecting another conversation. */
export function requestThreadWorkspaceEdit(request: WorkspacePickerRequest): void {
  useWorkspacePickerRequest.setState({ request });
}

/** Open workspace changes in a modal regardless of the context-menu click position. */
export function ThreadWorkspaceMenuHost() {
  const request = useWorkspacePickerRequest((state) => state.request);
  if (!request) return null;
  return (
    <ThreadWorkspaceMenu
      key={JSON.stringify([request.threadRef, request.position])}
      threadRef={request.threadRef}
      returnFocus={request.returnFocus}
      open
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
  "trigger" | "displayMode" | "open" | "onOpenChange" | "ariaLabel"
> & {
  readonly threadRef: ScopedThreadRef;
  readonly draftId?: DraftId;
  readonly returnFocus?: HTMLElement | false | undefined;
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
  const [internalOpen, setInternalOpen] = useState(false);
  const open = menuProps.open ?? internalOpen;
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

  /** Keep modal dismissal from interrupting a workspace mutation. */
  function setOpen(nextOpen: boolean) {
    if (pendingRef.current) return;
    setInternalOpen(nextOpen);
    if (!nextOpen) setError(null);
    menuProps.onOpenChange?.(nextOpen);
  }

  /** Keep failures in the dialog and prevent duplicate operations. */
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
      if (!canChangeWorkspace()) return false;
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
      const branch = selection.name.trim();
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
    <>
      {menuProps.open === undefined ? (
        <ThreadDetailsControl
          panel={menuProps.displayMode === "panel"}
          part="select"
          aria-label={menuProps.ariaLabel ?? "Change worktree"}
          onClick={() => setOpen(true)}
        >
          {menuProps.trigger ?? "Change worktree"}
        </ThreadDetailsControl>
      ) : null}
      {open ? (
        <WorkspaceChangeDialog
          returnFocus={menuProps.returnFocus}
          projectRef={projectRef}
          projectCwd={project.workspaceRoot}
          activeWorktreePath={activeWorktreePath}
          activeBranch={activeBranch}
          envLocked={pending || running || !canOperate}
          canCreateWorktree={canCreate}
          pending={pending}
          selectionHint={hint}
          onOpenChange={setOpen}
          onNewWorktreeSelect={createAndUseWorktree}
          onUseWorktree={selectWorktree}
        />
      ) : null}
    </>
  );
}
