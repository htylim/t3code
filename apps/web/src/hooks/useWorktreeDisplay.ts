import type { ScopedProjectRef } from "@t3tools/contracts";

import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { resolveWorktreeDisplay } from "../worktreeDisplay";

/** Recompute the label from current thread metadata and subscribe only to its saved color. */
export function useWorktreeDisplay(
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
  return resolveWorktreeDisplay({ worktreePath, projectCwd, savedColor });
}
