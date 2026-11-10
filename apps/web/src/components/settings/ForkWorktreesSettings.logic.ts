import { formatBytes } from "../../lib/formatBytes";
import type { WorktreeMeasurement } from "./useWorktreeCleanup";
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

/** One project's filtered row subscriptions and worktree-list availability. */
export interface ProjectWorktreeMeasurements {
  readonly search: string;
  readonly measurements: ReadonlyMap<string, WorktreeMeasurement>;
  readonly pending: boolean;
  readonly unavailable: boolean;
}

/** Count each environment/directory once and distinguish incomplete estimates from totals. */
export function worktreeTotalSpaceLabel(
  projects: readonly (ProjectWorktreeMeasurements | undefined)[],
): string | null {
  if (projects.length > 0 && projects.every((project) => project?.unavailable)) return null;
  const measurements = new Map<string, WorktreeMeasurement>();
  let listsPending = false;
  for (const project of projects) {
    if (project?.unavailable) continue;
    if (project === undefined || project.pending) listsPending = true;
    for (const [key, measurement] of project?.measurements ?? []) {
      const previous = measurements.get(key);
      if (
        previous === undefined ||
        (measurement.error === null && !measurement.pending && measurement.bytes !== null)
      )
        measurements.set(key, measurement);
    }
  }
  let bytes = 0;
  let pendingCount = 0;
  let unknownCount = 0;
  for (const measurement of measurements.values()) {
    if (measurement.error !== null) unknownCount++;
    else if (measurement.pending) pendingCount++;
    else if (measurement.bytes === null) unknownCount++;
    else {
      bytes += measurement.bytes;
    }
  }
  const parts = [`~${formatBytes(bytes)} total used`];
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (unknownCount > 0) parts.push(`${unknownCount} unknown`);
  if (listsPending) parts.push("Loading worktrees...");
  return parts.join(" · ");
}

/** A reason deletion is blocked, shared by the badge and disabled checkbox tooltip. */
export interface WorktreeSelectionBlocker {
  readonly label: "Project" | "Busy" | "Loading" | "Error" | "Read-only" | "Unsupported";
  readonly reason: string;
}

/** Keep loading distinct from failure and report each applicable deletion restriction. */
export function worktreeSelectionBlockers(input: {
  readonly supported: boolean;
  readonly containsProject: boolean;
  readonly isIdle: boolean;
  readonly historyReady: boolean;
  readonly historyError: string | null;
  readonly canRemove: boolean;
}): WorktreeSelectionBlocker[] {
  const blockers: WorktreeSelectionBlocker[] = [];
  if (!input.supported)
    blockers.push({
      label: "Unsupported",
      reason: "Worktree management requires a compatible Fork server.",
    });
  if (input.containsProject)
    blockers.push({
      label: "Project",
      reason: "Contains a registered T3 project and cannot be removed.",
    });
  if (!input.isIdle)
    blockers.push({
      label: "Busy",
      reason: "An agent is queued, starting, or running here. Stop it before cleanup.",
    });
  if (input.supported) {
    if (input.historyError !== null)
      blockers.push({
        label: "Error",
        reason: `Unable to load thread history: ${input.historyError}`,
      });
    else if (!input.historyReady)
      blockers.push({
        label: "Loading",
        reason: "Thread history must finish loading before cleanup.",
      });
  }
  if (!input.canRemove)
    blockers.push({ label: "Read-only", reason: "This connection cannot remove worktrees." });
  return blockers;
}
