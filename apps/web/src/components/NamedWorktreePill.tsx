import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import type { NamedWorktreeSelection } from "../namedWorktreeStore";
import { requestThreadWorkspaceEdit } from "./ThreadWorkspaceMenu";
import { SoftPill } from "./ui/soft-pill";

/** Open the Workspace picker without activating the pill's containing thread. */
export function NamedWorktreePill({
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
  worktree: NamedWorktreeSelection;
  className?: string;
}) {
  if (!projectRef || !projectCwd || !worktreePath) return null;
  return (
    <SoftPill
      color={worktree.color}
      className={className}
      render={<button type="button" aria-label={`Edit workspace ${worktree.name}`} />}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        requestThreadWorkspaceEdit({ threadRef, position: { x: bounds.left, y: bounds.bottom } });
      }}
    >
      {worktree.name}
    </SoftPill>
  );
}
