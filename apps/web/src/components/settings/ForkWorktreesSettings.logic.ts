import { msg } from "gt-react";
import { m, type MessageResolver } from "../../i18n/messages";
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
  resolve: MessageResolver = m,
): string {
  if (unavailable) return resolve(msg("Unavailable"));
  if (!ready) return resolve(msg("Loading..."));
  if (worktree === undefined) return resolve(msg("No threads"));
  if (worktree.parentDeleted) return resolve(msg("Deleted parent"));
  if (worktree.threadsSettled === undefined) return resolve(msg("Unavailable"));
  return worktree.threadsSettled ? resolve(msg("Settled")) : resolve(msg("Active"));
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
  resolve: MessageResolver = m,
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
  const parts = [resolve(msg("~{bytes} total used", { bytes: formatBytes(bytes) }))];
  if (pendingCount > 0) parts.push(resolve(msg("{count} pending", { count: pendingCount })));
  if (unknownCount > 0) parts.push(resolve(msg("{count} unknown", { count: unknownCount })));
  if (listsPending) parts.push(resolve(msg("Loading worktrees...")));
  return parts.join(" · ");
}

/** A reason deletion is blocked, shared by the badge and disabled checkbox tooltip. */
export interface WorktreeSelectionBlocker {
  readonly label: string;
  readonly reason: string;
}

/** Keep loading distinct from failure and report each applicable deletion restriction. */
export function worktreeSelectionBlockers(
  input: {
    readonly supported: boolean;
    readonly containsProject: boolean;
    readonly isIdle: boolean;
    readonly historyReady: boolean;
    readonly historyError: string | null;
    readonly canRemove: boolean;
  },
  resolve: MessageResolver = m,
): WorktreeSelectionBlocker[] {
  const blockers: WorktreeSelectionBlocker[] = [];
  if (!input.supported)
    blockers.push({
      label: resolve(msg("Unsupported")),
      reason: resolve(msg("Worktree management requires a compatible Fork server.")),
    });
  if (input.containsProject)
    blockers.push({
      label: resolve(msg("Project")),
      reason: resolve(msg("Contains a registered T3 project and cannot be removed.")),
    });
  if (!input.isIdle)
    blockers.push({
      label: resolve(msg("Busy")),
      reason: resolve(
        msg("An agent is queued, starting, or running here. Stop it before cleanup."),
      ),
    });
  if (input.supported) {
    if (input.historyError !== null)
      blockers.push({
        label: resolve(msg("Error")),
        reason: resolve(
          msg("Unable to load thread history: {error}", { error: input.historyError }),
        ),
      });
    else if (!input.historyReady)
      blockers.push({
        label: resolve(msg("Loading")),
        reason: resolve(msg("Thread history must finish loading before cleanup.")),
      });
  }
  if (!input.canRemove)
    blockers.push({
      label: resolve(msg("Read-only")),
      reason: resolve(msg("This connection cannot remove worktrees.")),
    });
  return blockers;
}
