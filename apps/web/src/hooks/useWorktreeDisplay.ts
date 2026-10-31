import type { ScopedProjectRef } from "@t3tools/contracts";

import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { useProject } from "../state/entities";
import { resolveWorktreeDisplay } from "../worktreeDisplay";

/** Resolve a workspace pill using its project's scratch status and saved worktree color. */
export function useWorktreeDisplay(
  projectRef: ScopedProjectRef | null,
  worktreePath: string | null,
  projectCwd?: string | null,
) {
  const project = useProject(projectRef);
  const savedColor = useNamedWorktreeStore((state) =>
    projectRef && worktreePath
      ? state.worktrees[namedWorktreeKey(projectRef, worktreePath)]?.color
      : undefined,
  );
  if (!projectRef || !projectCwd) return null;
  return resolveWorktreeDisplay({
    worktreePath,
    projectCwd,
    savedColor,
    isScratchProject: project?.isScratch,
  });
}
