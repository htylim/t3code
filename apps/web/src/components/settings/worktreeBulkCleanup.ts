import type { ScopedProjectRef } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";

export interface WorktreeCleanupTarget {
  readonly projectRef: ScopedProjectRef;
  readonly projectCwd: string;
  readonly path: string;
  readonly name: string;
}

export interface WorktreeCleanupInspection {
  readonly target: WorktreeCleanupTarget;
  readonly uncommittedFiles: number;
  readonly reclaimableBytes: number | null;
}

/** Worktrees shared by project records still have one selection and one space estimate. */
export function worktreeCleanupKey(target: WorktreeCleanupTarget): string {
  return JSON.stringify([
    target.projectRef.environmentId,
    normalizeProjectPathForComparison(target.path),
  ]);
}

/** Preserve every registered project checkout, including a project rooted inside a worktree. */
export function worktreeContainsProject(
  worktreePath: string,
  projectRoots: readonly string[],
): boolean {
  const normalizedWorktree = normalizeProjectPathForComparison(worktreePath).replaceAll("\\", "/");
  return projectRoots.some((root) => {
    const normalizedRoot = normalizeProjectPathForComparison(root).replaceAll("\\", "/");
    return (
      normalizedRoot === normalizedWorktree || normalizedRoot.startsWith(`${normalizedWorktree}/`)
    );
  });
}

/** Inspect everything before confirmation, then recheck each target without forcing newly dirty worktrees. */
export async function runWorktreeBulkCleanup(
  targets: readonly WorktreeCleanupTarget[],
  operations: {
    readonly inspect: (target: WorktreeCleanupTarget) => Promise<WorktreeCleanupInspection>;
    readonly confirm: (inspections: readonly WorktreeCleanupInspection[]) => Promise<boolean>;
    readonly remove: (target: WorktreeCleanupTarget, force: boolean) => Promise<void>;
    readonly onRemoved: (target: WorktreeCleanupTarget) => void;
  },
) {
  const uniqueTargets = new Map(targets.map((target) => [worktreeCleanupKey(target), target]));
  const inspections: WorktreeCleanupInspection[] = [];
  const removed: WorktreeCleanupTarget[] = [];
  const failures: Array<{ target: WorktreeCleanupTarget; message: string }> = [];
  for (const target of uniqueTargets.values()) {
    inspections.push(await operations.inspect(target));
  }
  if (inspections.length === 0 || !(await operations.confirm(inspections))) {
    return { cancelled: true, removed, failures };
  }
  for (const inspection of inspections) {
    const { target } = inspection;
    try {
      const current = await operations.inspect(target);
      if (inspection.uncommittedFiles === 0 && current.uncommittedFiles > 0) {
        throw new Error(
          "New uncommitted changes appeared after confirmation. Review this worktree again.",
        );
      }
      await operations.remove(target, current.uncommittedFiles > 0);
      removed.push(target);
      operations.onRemoved(target);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to remove this worktree.";
      failures.push({ target, message });
    }
  }
  return { cancelled: false, removed, failures };
}

/** Keep unknown sizes separate from genuine zero-byte estimates. */
export function summarizeWorktreeBytes(estimates: Iterable<number | null>) {
  let bytes = 0;
  let knownCount = 0;
  let unknownCount = 0;
  for (const estimate of estimates) {
    if (estimate === null) unknownCount++;
    else {
      bytes += estimate;
      knownCount++;
    }
  }
  return { bytes, knownCount, unknownCount };
}
