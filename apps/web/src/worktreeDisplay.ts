import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";

export interface WorktreeDisplay {
  readonly name: string;
  readonly color: string;
}

/** Describe every assigned worktree from its current directory and optional saved color. */
export function resolveWorktreeDisplay({
  worktreePath,
  projectCwd,
  savedColor,
}: {
  worktreePath: string | null;
  projectCwd?: string | null | undefined;
  savedColor?: string | undefined;
}): WorktreeDisplay | null {
  if (!worktreePath || worktreePath === projectCwd) return null;
  const directoryName =
    worktreePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || worktreePath;
  return { name: directoryName, color: savedColor || DEFAULT_SOFT_PILL_COLOR };
}
