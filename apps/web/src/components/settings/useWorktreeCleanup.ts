import { useAtomValue } from "@effect/atom-react";
import { AuthSourceControlWriteScope, supportsForkWorktrees } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import { AsyncResult, Atom } from "effect/reactivity";
import { useRef, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { formatBytes } from "../../lib/formatBytes";
import { useNamedWorktreeStore } from "../../namedWorktreeStore";
import { readEnvironment, useEnvironments } from "../../state/environments";
import { readProjects, readThreadShells } from "../../state/entities";
import { formatEnvironmentQueryError } from "../../state/query";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { isThreadWorkspaceBusy, isWorktreeThreadRunning } from "../BranchToolbar.logic";
import { toastManager } from "../ui/toast";
import {
  runWorktreeBulkCleanup,
  summarizeWorktreeBytes,
  worktreeCleanupKey,
  worktreeContainsProject,
  type WorktreeCleanupTarget,
} from "./worktreeBulkCleanup";

export interface WorktreeMeasurement {
  readonly bytes: number | null;
  readonly pending: boolean;
  readonly error: string | null;
}

const measurementsAtom = Atom.family((targetsKey: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(targetsKey) as readonly WorktreeCleanupTarget[];
    const measurements = new Map<string, WorktreeMeasurement>();
    for (const target of targets) {
      const measurement = get(
        vcsEnvironment.worktreeSize({
          environmentId: target.projectRef.environmentId,
          input: { cwd: target.projectCwd, path: target.path },
        }),
      );
      const size = AsyncResult.getOrElse(measurement, () => null);
      measurements.set(worktreeCleanupKey(target), {
        bytes: size?.reclaimableBytes ?? null,
        pending: measurement.waiting && size === null,
        error:
          measurement._tag === "Failure" ? formatEnvironmentQueryError(measurement.cause) : null,
      });
    }
    return measurements;
  }),
);

/** Share cached measurements between rows and the selection summary without background polling. */
export function useWorktreeMeasurements(targets: readonly WorktreeCleanupTarget[]) {
  const { environments } = useEnvironments();
  const supported = new Set(
    environments
      .filter((environment) =>
        supportsForkWorktrees(environment.serverConfig?.environment.capabilities),
      )
      .map((environment) => environment.environmentId),
  );
  return useAtomValue(
    measurementsAtom(
      JSON.stringify(targets.filter((target) => supported.has(target.projectRef.environmentId))),
    ),
  );
}

/** Sum only known estimates and keep unknown or pending sizes visible to the user. */
export function worktreeSpaceEstimate(
  measurements: ReadonlyMap<string, WorktreeMeasurement>,
  compact = false,
): string {
  const summary = summarizeWorktreeBytes(
    [...measurements.values()].map((measurement) =>
      measurement.error !== null ? null : measurement.bytes,
    ),
  );
  if (summary.knownCount === 0 && summary.unknownCount > 0)
    return compact ? "Size unknown" : "Space estimate unavailable";
  const estimate = compact
    ? `~${formatBytes(summary.bytes)}`
    : `~${formatBytes(summary.bytes)} to reclaim`;
  return summary.unknownCount > 0 ? `${estimate} + ${summary.unknownCount} unknown` : estimate;
}

/** Recheck destination permissions, checkout ownership and local changes around one bulk confirmation. */
export function useWorktreeCleanup(
  measurements: ReadonlyMap<string, WorktreeMeasurement>,
  onRemoved: (target: WorktreeCleanupTarget) => void,
) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const readRefs = useAtomCommand(vcsEnvironment.readWorktrees, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });

  /** Read fresh status without fetching remotes, refusing busy or protected checkout paths. */
  async function inspect(target: WorktreeCleanupTarget) {
    const environmentId = target.projectRef.environmentId;
    if (
      !supportsForkWorktrees(readEnvironment(environmentId)?.serverConfig?.environment.capabilities)
    )
      throw new Error(
        "Update this environment to a compatible Fork server before managing worktrees.",
      );
    if (!readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) {
      throw new Error(`This connection cannot remove ${target.name}.`);
    }
    const projectRoots = readProjects()
      .filter((project) => project.environmentId === environmentId)
      .map((project) => project.workspaceRoot);
    if (worktreeContainsProject(target.path, projectRoots)) {
      throw new Error(`${target.name} contains a project checkout and cannot be removed.`);
    }
    const running = readThreadShells().some(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.worktreePath !== null &&
        normalizeProjectPathForComparison(thread.worktreePath) ===
          normalizeProjectPathForComparison(target.path) &&
        (isThreadWorkspaceBusy(thread) || isWorktreeThreadRunning(thread.source)),
    );
    if (running) throw new Error(`An agent is running in ${target.name}. Stop it before cleanup.`);
    const refs = await readRefs({
      environmentId,
      input: { cwd: target.projectCwd, refresh: true },
    });
    if (refs._tag === "Failure") throw new Error(`Unable to verify ${target.name}.`);
    const ref = refs.value.refs.find(
      (entry) =>
        entry.worktreePath !== null &&
        normalizeProjectPathForComparison(entry.worktreePath) ===
          normalizeProjectPathForComparison(target.path),
    );
    if (!ref || ref.current) throw new Error(`${target.name} is no longer a removable worktree.`);
    if (
      refs.value.mainWorktreePath !== undefined &&
      refs.value.mainWorktreePath !== null &&
      normalizeProjectPathForComparison(refs.value.mainWorktreePath) ===
        normalizeProjectPathForComparison(target.path)
    )
      throw new Error(`${target.name} is the repository's main checkout and cannot be removed.`);
    const status = await refreshStatus({
      environmentId,
      input: { cwd: target.path, localOnly: true },
    });
    if (status._tag === "Failure" || !status.value.isRepo)
      throw new Error(`Unable to check uncommitted changes in ${target.name}.`);
    const uncommittedFiles = Math.max(
      status.value.workingTree.files.length,
      Number(status.value.hasWorkingTreeChanges),
    );
    const measurement = measurements.get(worktreeCleanupKey(target));
    return {
      target,
      uncommittedFiles,
      reclaimableBytes: measurement?.error ? null : (measurement?.bytes ?? null),
    };
  }

  /** Keep failed targets selected; a Git refusal never causes an automatic force-removal retry. */
  async function clean(targets: readonly WorktreeCleanupTarget[]) {
    if (inFlight.current || targets.length === 0) return;
    inFlight.current = true;
    setPending(true);
    const operation = runWorktreeBulkCleanup(targets, {
      inspect,
      confirm: async (inspections) => {
        const dirty = inspections.filter((inspection) => inspection.uncommittedFiles > 0);
        const space = summarizeWorktreeBytes(
          inspections.map((inspection) => inspection.reclaimableBytes),
        );
        const targetLabel = `${inspections.length} ${inspections.length === 1 ? "worktree" : "worktrees"}`;
        const title =
          dirty.length > 0
            ? "Remove worktrees with uncommitted changes?"
            : `Remove ${targetLabel}?`;
        const warning =
          dirty.length > 0
            ? `${dirty.length} selected ${dirty.length === 1 ? "worktree has" : "worktrees have"} uncommitted changes. These changes will be permanently deleted. Do you want to proceed?\n\n`
            : "";
        const estimate =
          space.knownCount === 0
            ? "Space estimate unavailable."
            : space.unknownCount > 0
              ? `Known space estimate: ${formatBytes(space.bytes)}. Some sizes are unavailable.`
              : `Estimated space to reclaim: ${formatBytes(space.bytes)}.`;
        return (
          (await requestConfirmDialog(
            `${title}\n${warning}${estimate}\nWorktree directories, including ignored files, will be permanently deleted.\nBranches and thread history are kept.`,
            {
              variant: "destructive",
              confirmLabel: `Remove ${targetLabel}`,
              details: [
                ...inspections
                  .slice(0, 20)
                  .map(
                    ({ target, uncommittedFiles }) =>
                      `${target.name}${uncommittedFiles > 0 ? ` · ${uncommittedFiles} uncommitted ${uncommittedFiles === 1 ? "file" : "files"}` : ""} · ${target.path}`,
                  ),
                ...(inspections.length > 20
                  ? [`${inspections.length - 20} more selected worktrees.`]
                  : []),
              ],
            },
          )) ?? false
        );
      },
      remove: async (target, force) => {
        const removed = await removeWorktree({
          environmentId: target.projectRef.environmentId,
          input: { cwd: target.projectCwd, path: target.path, force },
        });
        if (removed._tag === "Failure")
          throw new Error(
            `Git could not remove ${target.name}. It may be locked or have changed since confirmation.`,
          );
      },
      onRemoved: (target) => {
        useNamedWorktreeStore.getState().forget(target.projectRef, target.path);
        onRemoved(target);
      },
    });
    await operation
      .then((outcome) => {
        if (!outcome.cancelled) {
          toastManager.add({
            type: outcome.failures.length > 0 ? "error" : "success",
            title: `${outcome.removed.length} ${outcome.removed.length === 1 ? "worktree" : "worktrees"} removed${outcome.failures.length > 0 ? `, ${outcome.failures.length} kept` : ""}`,
            description: outcome.failures[0]?.message ?? "Branches and thread history were kept.",
          });
        }
      })
      .catch((cause: unknown) => {
        toastManager.add({
          type: "error",
          title: "Cleanup could not proceed",
          description:
            cause instanceof Error ? cause.message : "Unable to check the selected worktrees.",
        });
      })
      .finally(() => {
        inFlight.current = false;
        setPending(false);
      });
  }

  return { pending, clean };
}
