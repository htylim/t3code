import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";

export interface WorktreeDisplay {
  readonly name: string;
  readonly color: string;
}

/** Describe assigned Git worktrees, excluding scratch folders and the local checkout. */
export function resolveWorktreeDisplay({
  worktreePath,
  projectCwd,
  savedColor,
  isScratchProject = false,
}: {
  worktreePath: string | null;
  projectCwd?: string | null | undefined;
  savedColor?: string | undefined;
  isScratchProject?: boolean | undefined;
}): WorktreeDisplay | null {
  if (isScratchProject || !worktreePath || worktreePath === projectCwd) return null;
  const directoryName =
    worktreePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || worktreePath;
  return { name: directoryName, color: savedColor || DEFAULT_SOFT_PILL_COLOR };
}
