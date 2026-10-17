import type { ScopedProjectRef } from "@t3tools/contracts";
import type { NamedWorktreeSelection } from "../namedWorktreeStore";
import { requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { SoftPill } from "./ui/soft-pill";

/** Open the same worktree editor from navigation without activating its containing thread. */
export function NamedWorktreePill({
  projectRef,
  projectCwd,
  worktreePath,
  worktree,
  className,
}: {
  projectRef: ScopedProjectRef | null;
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
      render={<button type="button" aria-label={`Edit worktree ${worktree.name}`} />}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        requestNamedWorktreeEdit({ projectRef, projectCwd, worktreePath });
      }}
    >
      {worktree.name}
    </SoftPill>
  );
}
