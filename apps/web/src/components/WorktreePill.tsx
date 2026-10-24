import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { readLocalApi } from "../localApi";
import { readThreadShell, useQuietThreadShell } from "../state/entities";
import type { WorktreeDisplay } from "../worktreeDisplay";
import { isThreadWorkspaceBusy } from "./BranchToolbar.logic";
import { requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { requestThreadWorkspaceEdit } from "./ThreadWorkspaceMenu";
import { SoftPill } from "./ui/soft-pill";

/** Rename on click and offer workspace changes without activating the containing thread. */
export function WorktreePill({
  projectRef,
  threadRef,
  projectCwd,
  worktreePath,
  worktree,
  className,
}: {
  projectRef: ScopedProjectRef | null;
  threadRef: ScopedThreadRef;
  projectCwd: string | null | undefined;
  worktreePath: string | null;
  worktree: WorktreeDisplay;
  className?: string;
}) {
  const thread = useQuietThreadShell(threadRef);
  const busy = thread !== null && isThreadWorkspaceBusy(thread);
  if (!projectRef || !projectCwd || !worktreePath) return null;
  return (
    <SoftPill
      color={worktree.color}
      className={className}
      render={<button type="button" aria-label={`Rename worktree ${worktree.name}`} />}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Disabled context-menu actions leave focus on the pill, so Escape must reach the menu.
        if (event.key !== "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.ctrlKey || busy) return;
        requestNamedWorktreeEdit({
          projectRef,
          projectCwd,
          worktreePath,
          returnFocus: event.detail === 0 ? event.currentTarget : false,
        });
      }}
      onContextMenu={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const api = readLocalApi();
        if (!api) return;
        const position = { x: event.clientX, y: event.clientY };
        const returnFocus = event.button === 0 && !event.ctrlKey ? event.currentTarget : false;
        const action = await api.contextMenu.show(
          [
            { id: "rename-worktree", label: "Rename worktree", icon: "pencil", disabled: busy },
            { id: "change-worktree", label: "Change worktree", icon: "folder", disabled: busy },
          ],
          position,
        );
        const currentThread = readThreadShell(threadRef);
        if (currentThread && isThreadWorkspaceBusy(currentThread)) return;
        if (action === "rename-worktree") {
          requestNamedWorktreeEdit({ projectRef, projectCwd, worktreePath, returnFocus });
        } else if (action === "change-worktree") {
          requestThreadWorkspaceEdit({ threadRef, position, returnFocus });
        }
      }}
    >
      {worktree.name}
    </SoftPill>
  );
}
