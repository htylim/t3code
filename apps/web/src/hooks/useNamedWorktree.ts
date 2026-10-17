import type { ScopedProjectRef } from "@t3tools/contracts";

import {
  namedWorktreeKey,
  resolveNamedWorktree,
  useNamedWorktreeStore,
} from "../namedWorktreeStore";

/** Subscribe only to this worktree's saved color when rendering its name. */
export function useNamedWorktree(
  projectRef: ScopedProjectRef | null,
  worktreePath: string | null,
  projectCwd?: string | null,
) {
  const savedColor = useNamedWorktreeStore((state) =>
    projectRef && worktreePath
      ? state.worktrees[namedWorktreeKey(projectRef, worktreePath)]?.color
      : undefined,
  );
  if (!projectRef || !projectCwd) return null;
  return resolveNamedWorktree({ worktreePath, projectCwd, savedColor });
}
