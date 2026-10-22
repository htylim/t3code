import { useEnvironmentScope } from "../state/session";
import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { useAtomValue } from "@effect/atom-react";
import type { OrchestrationV2ThreadShell, ScopedProjectRef } from "@t3tools/contracts";
import { AuthOrchestrationOperateScope, GitCommandError } from "@t3tools/contracts";
import { getBrowseParentPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { useWorktreeDisplay } from "../hooks/useWorktreeDisplay";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import {
  useArchivedThreadSnapshots,
  refreshArchivedThreadsForEnvironment,
} from "../lib/archivedThreadsState";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { useThreadShellsForProjectRefs } from "../state/entities";
import { filesystemEnvironment } from "../state/filesystem";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { vcsEnvironment } from "../state/vcs";
import { isThreadWorkspaceBusy, isWorktreeThreadRunning } from "./BranchToolbar.logic";
import { resolveWorktreeRenameIssue } from "./NamedWorktreeDialog.logic";
import { SoftPillColorPicker } from "./SoftPillColorPicker";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SoftPill } from "./ui/soft-pill";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";

interface WorktreeEditRequest {
  readonly projectRef: ScopedProjectRef;
  readonly projectCwd: string;
  readonly worktreePath: string;
  /** Return keyboard users to their trigger without refocusing pointer-opened pills. */
  readonly returnFocus?: HTMLElement | false;
}
const useWorktreeEditRequest = create<{ request: WorktreeEditRequest | null }>(() => ({
  request: null,
}));
const isGitCommandError = Schema.is(GitCommandError);

/** Request an editor for one environment's existing worktree. */
export function requestNamedWorktreeEdit(request: WorktreeEditRequest): void {
  useWorktreeEditRequest.setState({ request });
}

/** Close only the request that owns this dialog. */
function closeWorktreeEditor(request: WorktreeEditRequest): void {
  if (useWorktreeEditRequest.getState().request === request)
    useWorktreeEditRequest.setState({ request: null });
}

/** Mount one editor above the sidebar, breadcrumb, and floating details panel. */
export function NamedWorktreeDialogHost() {
  const request = useWorktreeEditRequest((state) => state.request);
  return request ? (
    <NamedWorktreeDialog
      key={namedWorktreeKey(request.projectRef, request.worktreePath)}
      request={request}
    />
  ) : null;
}

/** Keep rejected edits open and retain the moved path if updating a thread needs a retry. */
function NamedWorktreeDialog({ request }: { request: WorktreeEditRequest }) {
  const { projectRef, projectCwd } = request;
  const worktreeDisplay = useWorktreeDisplay(projectRef, request.worktreePath, projectCwd);
  const [worktreePath, setWorktreePath] = useState(request.worktreePath);
  const initialName = request.worktreePath.split(/[\\/]/).at(-1) ?? request.worktreePath;
  const initialColor = worktreeDisplay?.color ?? DEFAULT_SOFT_PILL_COLOR;
  const [name, setName] = useState(worktreeDisplay?.name ?? initialName);
  const [color, setColor] = useState(initialColor);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rejectedName, setRejectedName] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const canRename = useAtomValue(
    vcsEnvironment.renameWorktree.permissionAtom(projectRef.environmentId),
  );
  const canUpdateThreads = useEnvironmentScope(
    projectRef.environmentId,
    AuthOrchestrationOperateScope,
  );
  const renameWorktree = useAtomCommand(vcsEnvironment.renameWorktree, { reportFailure: false });
  const updateThread = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const liveThreads = useThreadShellsForProjectRefs([projectRef]);
  const archived = useArchivedThreadSnapshots([projectRef.environmentId]);
  const parentPath = getBrowseParentPath(worktreePath);
  const siblings = useEnvironmentQuery(
    parentPath
      ? filesystemEnvironment.browse({
          environmentId: projectRef.environmentId,
          input: { partialPath: parentPath },
        })
      : null,
  );
  const refreshSiblings = siblings.refresh;
  useEffect(() => {
    refreshSiblings();
  }, [refreshSiblings]);
  const threadsById = new Map<string, OrchestrationV2ThreadShell>();
  for (const snapshot of archived.snapshots) {
    for (const thread of snapshot.snapshot.threads) {
      if (thread.projectId === projectRef.projectId) threadsById.set(thread.id, thread);
    }
  }
  for (const thread of liveThreads) threadsById.set(thread.id, thread.source);
  const threads = [...threadsById.values()];
  const directoryName = name.trim();
  const currentName = worktreePath.split(/[\\/]/).at(-1) ?? worktreePath;
  const renaming = directoryName !== currentName;
  const running =
    liveThreads.some(
      (thread) =>
        (thread.worktreePath === worktreePath || thread.worktreePath === request.worktreePath) &&
        isThreadWorkspaceBusy(thread),
    ) ||
    threads.some(
      (thread) =>
        (thread.worktreePath === worktreePath || thread.worktreePath === request.worktreePath) &&
        isWorktreeThreadRunning(thread),
    );
  let validationMessage = resolveWorktreeRenameIssue({
    worktreePath,
    name,
    existingPaths: siblings.data?.entries.map((entry) => entry.fullPath) ?? [],
  });
  if (directoryName === rejectedName)
    validationMessage = "A directory with that name already exists.";
  if (renaming && !validationMessage) {
    if (!canRename || !canUpdateThreads)
      validationMessage = "This connection cannot rename worktrees.";
    else if (archived.error || siblings.error)
      validationMessage = "Unable to check the worktree. Reconnect and try again.";
    else if (archived.isLoading || siblings.isPending || !siblings.data)
      validationMessage = "Checking directory names and thread history...";
  }
  if (running) validationMessage = "Stop running agents in this worktree before editing it.";
  const unchanged = !renaming && color === initialColor && worktreePath === request.worktreePath;
  const disabled = saving || !!validationMessage || unchanged;

  /** Move once, then update every saved or draft thread before closing the editor. */
  async function saveWorktree(): Promise<void> {
    if (disabled) return;
    setSaving(true);
    setSaveError(null);
    let savedPath = worktreePath;
    if (renaming) {
      const renamed = await renameWorktree({
        environmentId: projectRef.environmentId,
        input: { cwd: projectCwd, path: worktreePath, newDirName: directoryName },
      });
      if (renamed._tag === "Failure") {
        const failure = squashAtomCommandFailure(renamed);
        const message = isGitCommandError(failure)
          ? failure.detail
          : "Unable to rename the worktree. Try again.";
        if (/already exists/i.test(message)) setRejectedName(directoryName);
        setSaveError(message);
        setSaving(false);
        siblings.refresh();
        return;
      }
      savedPath = renamed.value.worktree.path;
      setWorktreePath(savedPath);
      refreshSiblings();
      useNamedWorktreeStore.getState().move(projectRef, worktreePath, savedPath);
    }
    if (savedPath !== request.worktreePath) {
      for (const thread of threads) {
        if (thread.worktreePath !== request.worktreePath && thread.worktreePath !== worktreePath)
          continue;
        const updated = await updateThread({
          environmentId: projectRef.environmentId,
          input: { threadId: thread.id, worktreePath: savedPath },
        });
        if (updated._tag === "Failure") {
          setSaveError(
            "The directory was renamed, but a thread could not be updated. Save again to retry.",
          );
          setSaving(false);
          return;
        }
      }
      const draftStore = useComposerDraftStore.getState();
      for (const [draftKey, draft] of Object.entries(draftStore.draftThreadsByThreadKey)) {
        if (
          draft.environmentId !== projectRef.environmentId ||
          draft.projectId !== projectRef.projectId
        )
          continue;
        if (draft.worktreePath !== request.worktreePath && draft.worktreePath !== worktreePath)
          continue;
        draftStore.setDraftThreadContext(DraftId.make(draftKey), { worktreePath: savedPath });
      }
      refreshArchivedThreadsForEnvironment(projectRef.environmentId);
    }
    useNamedWorktreeStore.getState().setColor(projectRef, savedPath, color);
    setSaving(false);
    closeWorktreeEditor(request);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving && worktreePath === request.worktreePath) closeWorktreeEditor(request);
      }}
    >
      <DialogPopup finalFocus={() => request.returnFocus ?? true}>
        <DialogHeader>
          <DialogTitle>Rename worktree</DialogTitle>
          <DialogDescription>
            Rename the worktree directory and choose its color. The Git branch keeps its name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void saveWorktree();
          }}
        >
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor={inputId}>Worktree directory name</Label>
                <Input
                  id={inputId}
                  autoFocus
                  value={name}
                  disabled={saving || running || worktreePath !== request.worktreePath}
                  aria-invalid={!!validationMessage}
                  aria-describedby={validationMessage ? helpId : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaveError(null);
                  }}
                />
                {validationMessage ? (
                  <p id={helpId} role="status" className="text-sm text-muted-foreground">
                    {validationMessage}
                  </p>
                ) : null}
              </div>
              <SoftPillColorPicker
                label="Worktree"
                color={color}
                disabled={saving || running}
                onChange={(nextColor) => setColor(nextColor ?? DEFAULT_SOFT_PILL_COLOR)}
              />
              <div className="min-w-0">
                <SoftPill color={color}>{directoryName || currentName}</SoftPill>
              </div>
              {saveError ? (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving || worktreePath !== request.worktreePath}
              onClick={() => closeWorktreeEditor(request)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
