import { WorktreeDirectoryName } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  getBrowseParentPath,
  normalizeProjectPathForComparison,
} from "@t3tools/client-runtime/state/projects";

const isWorktreeDirectoryName = Schema.is(WorktreeDirectoryName);

/** Validate a sibling directory name without treating the existing directory as a collision. */
export function resolveWorktreeRenameIssue({
  worktreePath,
  name,
  existingPaths,
}: {
  worktreePath: string;
  name: string;
  existingPaths: readonly string[];
}): string | null {
  const directoryName = name.trim();
  if (!isWorktreeDirectoryName(directoryName))
    return "Enter a directory name without path separators.";
  const parentPath = getBrowseParentPath(worktreePath);
  if (!parentPath) return "Unable to resolve the worktree's parent directory.";
  const targetPath = normalizeProjectPathForComparison(`${parentPath}${directoryName}`);
  const currentPath = normalizeProjectPathForComparison(worktreePath);
  if (targetPath === currentPath) return null;
  if (existingPaths.some((path) => normalizeProjectPathForComparison(path) === targetPath)) {
    return "A directory with that name already exists.";
  }
  return null;
}
