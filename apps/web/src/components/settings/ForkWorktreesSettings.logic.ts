import type { WorktreeRow } from "../BranchToolbar.logic";
import type {
  ForkWorktreeActivityResult,
  ForkWorktreeCleanupAge,
  VcsRef,
} from "@t3tools/contracts";

/** Exclude the project checkout, including its root when the project is a subdirectory. */
export function managedWorktreeRows(
  refs: readonly VcsRef[],
  rows: readonly WorktreeRow[],
  projectCwd: string,
  mainWorktreePath?: string | null,
): WorktreeRow[] {
  const currentRef = refs.find((ref) => ref.current && ref.worktreePath !== null);
  const checkoutPath = currentRef?.worktreePath ?? projectCwd;
  return rows.filter(
    (row) =>
      row.worktreePath !== checkoutPath &&
      row.worktreePath !== projectCwd &&
      row.worktreePath !== mainWorktreePath,
  );
}

/** Order numeric cleanup ages from youngest to oldest, then keep nonnumeric rows in input order. */
export function sortWorktreesByCleanupAge(
  rows: readonly WorktreeRow[],
  cleanupAgesByPath: ReadonlyMap<string, ForkWorktreeCleanupAge>,
): WorktreeRow[] {
  return rows.toSorted((left, right) => {
    const leftSince = cleanupAgesByPath.get(left.worktreePath)?.since ?? null;
    const rightSince = cleanupAgesByPath.get(right.worktreePath)?.since ?? null;
    if (leftSince === rightSince) return 0;
    if (leftSince === null) return 1;
    if (rightSince === null) return -1;
    return rightSince - leftSince;
  });
}

/** Keep missing summaries explicit when a server cannot report every associated thread. */
export function worktreeThreadsLabel(
  worktree: ForkWorktreeActivityResult["worktrees"][number] | undefined,
  ready: boolean,
  unavailable: boolean,
): string {
  if (unavailable) return "Unavailable";
  if (!ready) return "Loading...";
  if (worktree === undefined) return "No threads";
  if (worktree.parentDeleted) return "Deleted parent";
  if (worktree.threadsSettled === undefined) return "Unavailable";
  return worktree.threadsSettled ? "Settled" : "Active";
}
