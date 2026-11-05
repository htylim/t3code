import type { WorktreeRow } from "../BranchToolbar.logic";
import type {
  ForkWorktreeActivityResult,
  OrchestrationV2ThreadShell,
  VcsRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

type WorktreeActivityThread = Pick<
  OrchestrationV2ThreadShell,
  | "worktreePath"
  | "createdAt"
  | "latestUserMessageAt"
  | "latestVisibleMessage"
  | "latestRunRequestedAt"
  | "latestRunStartedAt"
  | "latestRunCompletedAt"
>;

/** Find the newest conversation activity, including archived threads and excluding metadata edits. */
export function latestWorktreeActivity(
  threads: readonly WorktreeActivityThread[],
  worktreePath: string,
  projectCwd: string,
  worktreeActivityByPath?: ReadonlyMap<string, number>,
): number | null {
  let latestActivity = worktreeActivityByPath?.get(worktreePath) ?? null;
  for (const thread of threads) {
    if ((thread.worktreePath ?? projectCwd) !== worktreePath) continue;
    const timestamps = [
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestVisibleMessage?.updatedAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ];
    for (const timestamp of timestamps) {
      if (timestamp == null) continue;
      latestActivity = Math.max(latestActivity ?? 0, DateTime.toEpochMillis(timestamp));
    }
  }
  return latestActivity;
}

/** Count local calendar boundaries rather than elapsed 24-hour periods, including across DST. */
export function worktreeInactivityDays(activityAt: number, now: Date): number {
  const activityDate = new Date(activityAt);
  const activityDay = Date.UTC(
    activityDate.getFullYear(),
    activityDate.getMonth(),
    activityDate.getDate(),
  );
  const currentDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((currentDay - activityDay) / 86_400_000));
}

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

/** Sort newest activity first, preserving input order for ties and putting unused worktrees last. */
export function sortWorktreesByActivity(
  rows: readonly WorktreeRow[],
  threads: readonly WorktreeActivityThread[],
  projectCwd: string,
  worktreeActivityByPath?: ReadonlyMap<string, number>,
): WorktreeRow[] {
  return rows
    .map((row) => ({
      row,
      activityAt: latestWorktreeActivity(
        threads,
        row.worktreePath,
        projectCwd,
        worktreeActivityByPath,
      ),
    }))
    .sort((left, right) => {
      if (left.activityAt === right.activityAt) return 0;
      if (left.activityAt === null) return 1;
      if (right.activityAt === null) return -1;
      return right.activityAt - left.activityAt;
    })
    .map(({ row }) => row);
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
