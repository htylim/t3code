import {
  supportsForkWorktrees,
  type OrchestrationV2ThreadShell,
  type ScopedProjectRef,
  type ForkWorktreeCleanupStatusResult,
  type ForkWorktreeCleanupProgress,
} from "@t3tools/contracts";
import {
  GitBranchIcon,
  InfoIcon,
  Trash2Icon,
  HourglassIcon,
  CircleAlertIcon,
  SearchIcon,
  LockKeyholeIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useWorkspaceChoices } from "../../hooks/useWorkspaceChoices";
import { namedWorktreeKey, useNamedWorktreeStore } from "../../namedWorktreeStore";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { formatBytes } from "../../lib/formatBytes";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { isWorktreeThreadRunning, type WorktreeRow } from "../BranchToolbar.logic";
import { WorktreeActionsMenu } from "../WorktreeActionsMenu";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  useWorktreeCleanup,
  useWorktreeMeasurements,
  worktreeSpaceEstimate,
  type WorktreeMeasurement,
} from "./useWorktreeCleanup";
import {
  worktreeCleanupKey,
  worktreeContainsProject,
  type WorktreeCleanupTarget,
} from "./worktreeBulkCleanup";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  managedWorktreeRows,
  worktreeTotalSpaceLabel,
  worktreeSelectionBlockers,
  type WorktreeSelectionBlocker,
  type ProjectWorktreeMeasurements,
  sortWorktreesByCleanupAge,
  worktreeThreadsLabel,
} from "./ForkWorktreesSettings.logic";
import { FORK_SETTINGS_AVAILABLE } from "./forkSettingsAvailability";
import { SettingsGroup } from "./SettingsGroup";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer } from "./settingsLayout";

/** Manage existing worktrees in the selected projects and environments. */
export function ForkWorktreesSettings() {
  const { scope, groups, environments } = useSettingsScope();
  const [search, setSearch] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, WorktreeCleanupTarget>>(
    () => new Map(),
  );
  const [projectMeasurements, setProjectMeasurements] = useState<
    ReadonlyMap<string, ProjectWorktreeMeasurements>
  >(() => new Map());
  /** Collect existing row subscriptions without starting another set of disk measurements. */
  const reportMeasurements = useStableCallback(
    (projectKey: string, measurements: ProjectWorktreeMeasurements | null) => {
      setProjectMeasurements((previous) => {
        const next = new Map(previous);
        if (measurements === null) next.delete(projectKey);
        else next.set(projectKey, measurements);
        return next;
      });
    },
  );
  const selectedTargets = [...selected.values()];
  const selectedSizes = useWorktreeMeasurements(selectedTargets);
  const cleanup = useWorktreeCleanup(selectedSizes, (target) => {
    setSelected((previous) => {
      const next = new Map(previous);
      next.delete(worktreeCleanupKey(target));
      return next;
    });
  });
  /** Group checkboxes and duplicate rows share a selection keyed by environment and directory. */
  function selectTargets(targets: readonly WorktreeCleanupTarget[], checked: boolean) {
    setSelected((previous) => {
      const next = new Map(previous);
      for (const target of targets) {
        if (checked) next.set(worktreeCleanupKey(target), target);
        else next.delete(worktreeCleanupKey(target));
      }
      return next;
    });
  }
  const nowMinute = useNowMinute();
  if (!FORK_SETTINGS_AVAILABLE) return null;
  const environmentIds = new Set(scope.environmentIds);
  const selectedMembers =
    scope.kind === "project" || scope.kind === "checkout" ? new Set(scope.members) : null;
  const projects: Array<{ project: SidebarProjectGroupMember; title: string }> = [];
  for (const group of groups) {
    for (const project of group.memberProjects) {
      if (project.isScratch) continue;
      if (!environmentIds.has(project.environmentId)) continue;
      if (selectedMembers && !selectedMembers.has(project)) continue;
      projects.push({ project, title: group.displayName });
    }
  }

  const totalSpace = worktreeTotalSpaceLabel(
    projects.map(({ project }) => {
      const snapshot = projectMeasurements.get(project.physicalProjectKey);
      return snapshot?.search === search ? snapshot : undefined;
    }),
  );
  const spaceLabel =
    totalSpace !== null && cleaning && selected.size > 0
      ? `${worktreeSpaceEstimate(selectedSizes)} (of ${totalSpace}) · ${selected.size} selected`
      : totalSpace;

  return (
    <SettingsPageContainer>
      <section
        className="@container/worktree-list space-y-4"
        aria-labelledby="fork-worktrees-heading"
      >
        <div className="space-y-1 px-3 sm:px-4">
          <h2 id="fork-worktrees-heading" className="text-base font-semibold">
            Worktree Manager
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage existing worktrees across projects and environments.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(8rem,1fr)_auto] items-center gap-3 px-3 @min-[48rem]/worktree-list:grid-cols-[minmax(8rem,1fr)_auto_auto] sm:px-4">
          <div className="min-w-0 @min-[48rem]/worktree-list:max-w-xs">
            <Input
              type="search"
              aria-label="Search worktrees"
              placeholder="Search worktrees..."
              value={search}
              disabled={cleanup.pending}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelected(new Map());
              }}
            />
          </div>
          {spaceLabel !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="status"
                    aria-live="polite"
                    tabIndex={0}
                    className="min-w-0 text-right text-xs text-muted-foreground"
                  />
                }
              >
                {spaceLabel}
              </TooltipTrigger>
              <TooltipPopup>
                {spaceLabel}. Estimated space for the worktrees matching the current filters. Shared
                files and dependency stores are excluded. Actual freed space may differ.
              </TooltipPopup>
            </Tooltip>
          ) : (
            <span />
          )}
          <div className="col-span-2 flex h-8 min-w-0 items-center justify-end gap-3 @min-[48rem]/worktree-list:col-span-1">
            {!cleaning ? (
              <Button
                variant="outline"
                size="sm"
                disabled={projects.length === 0}
                onClick={() => setCleaning(true)}
              >
                <Trash2Icon /> Delete Worktrees...
              </Button>
            ) : (
              <>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    autoFocus
                    disabled={cleanup.pending}
                    onClick={() => {
                      setSelected(new Map());
                      setCleaning(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selected.size === 0 || cleanup.pending}
                    onClick={() => void cleanup.clean(selectedTargets)}
                  >
                    {cleanup.pending
                      ? "Deleting..."
                      : `Delete selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        {projects.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No projects in this selection.</p>
        ) : null}
        {projects.map(({ project, title }) => (
          <ProjectWorktrees
            key={project.physicalProjectKey}
            project={project}
            title={title}
            search={search}
            onMeasurementsChange={reportMeasurements}
            hideEmpty={selectedMembers === null}
            now={new Date(`${nowMinute}:00.000Z`)}
            cleaning={cleaning}
            selected={selected}
            pending={cleanup.pending}
            onSelectionChange={selectTargets}
            projectRoots={groups
              .flatMap((group) => group.memberProjects)
              .filter((member) => member.environmentId === project.environmentId)
              .map((member) => member.workspaceRoot)}
            supported={environments.some(
              (environment) =>
                environment.environmentId === project.environmentId &&
                supportsForkWorktrees(environment.serverConfig?.environment.capabilities),
            )}
            connected={environments.some(
              (environment) =>
                environment.environmentId === project.environmentId &&
                environment.connection.phase === "connected",
            )}
          />
        ))}
      </section>
    </SettingsPageContainer>
  );
}

/** Load each checkout independently so an offline environment cannot hide another one's worktrees. */
function ProjectWorktrees({
  project,
  title,
  search,
  now,
  connected,
  supported,
  hideEmpty,
  cleaning,
  selected,
  pending,
  onSelectionChange,
  projectRoots,
  onMeasurementsChange,
}: {
  readonly project: SidebarProjectGroupMember;
  readonly title: string;
  readonly search: string;
  readonly now: Date;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly hideEmpty: boolean;
  readonly cleaning: boolean;
  readonly selected: ReadonlyMap<string, WorktreeCleanupTarget>;
  readonly pending: boolean;
  readonly onSelectionChange: (targets: readonly WorktreeCleanupTarget[], checked: boolean) => void;
  readonly projectRoots: readonly string[];
  readonly onMeasurementsChange: (
    projectKey: string,
    measurements: ProjectWorktreeMeasurements | null,
  ) => void;
}) {
  const { environments } = useSettingsScope();
  const cleanupStatusSupported =
    environments.find((environment) => environment.environmentId === project.environmentId)
      ?.serverConfig?.environment.capabilities.fork?.worktrees?.cleanupStatus === true;
  const cleanupDetailsSupported =
    environments.find((environment) => environment.environmentId === project.environmentId)
      ?.serverConfig?.environment.capabilities.fork?.worktrees?.cleanupDetails === true;
  const projectRef = { environmentId: project.environmentId, projectId: project.id };
  const choices = useWorkspaceChoices({
    projectRef,
    projectCwd: project.workspaceRoot,
    activeWorktreePath: null,
    activeBranch: null,
    includeUnnamed: true,
  });
  const progress = useEnvironmentQuery(
    supported && connected && cleanupDetailsSupported
      ? vcsEnvironment.worktreeCleanupProgress({
          environmentId: project.environmentId,
          input: { worktreePaths: choices.rows.map((row) => row.worktreePath) },
        })
      : null,
  );
  const progressByPath = new Map(
    progress.data?.worktrees.map((entry) => [entry.worktreePath, entry]),
  );
  const removedPathsKey = JSON.stringify(
    progress.data?.worktrees
      .filter((entry) => entry.state === "removed")
      .map((entry) => entry.worktreePath) ?? [],
  );
  const registry = useContext(RegistryContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refresh Git's worktree list after the server confirms a removal
  useEffect(() => {
    if (removedPathsKey !== "[]")
      void runAtomCommand(
        registry,
        vcsEnvironment.refreshWorktrees,
        {
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot, refresh: true },
        },
        { reportFailure: false },
      );
  }, [removedPathsKey, registry, project.environmentId, project.workspaceRoot]);
  const canRemove = useAtomValue(
    vcsEnvironment.removeWorktree.permissionAtom(project.environmentId),
  );
  const activity = useEnvironmentQuery(
    supported && connected
      ? vcsEnvironment.worktreeActivity({
          environmentId: project.environmentId,
          input: { worktreePaths: choices.rows.map((row) => row.worktreePath) },
        })
      : null,
  );
  const worktreeThreadsByPath = new Map(
    activity.data?.worktrees.map((worktree) => [worktree.worktreePath, worktree]),
  );
  const rows = managedWorktreeRows(
    choices.refsQuery.data?.refs ?? [],
    choices.rows,
    project.workspaceRoot,
    choices.refsQuery.data?.mainWorktreePath,
  );
  const query = search.trim().toLowerCase();
  const visibleRows = rows.filter((row) =>
    `${title} ${project.workspaceRoot} ${project.environmentLabel ?? ""} ${row.dirName} ${row.refName ?? ""}`
      .toLowerCase()
      .includes(query),
  );
  const protection = useEnvironmentQuery(
    supported && connected && cleanupStatusSupported
      ? vcsEnvironment.worktreeCleanupStatus({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            worktreePaths: visibleRows.map((row) => row.worktreePath),
          },
        })
      : null,
  );
  const protectionByPath = new Map(
    protection.data?.worktrees.map((worktree) => [worktree.worktreePath, worktree]),
  );

  const cleanupAgesByPath = new Map(
    protection.data?.worktrees.flatMap((worktree) =>
      worktree.age === undefined ? [] : [[worktree.worktreePath, worktree.age] as const],
    ),
  );
  const sortedRows = sortWorktreesByCleanupAge(visibleRows, cleanupAgesByPath);

  const targets = visibleRows.map((row): WorktreeCleanupTarget => ({
    projectRef,
    projectCwd: project.workspaceRoot,
    path: row.worktreePath,
    name: row.dirName,
  }));
  const measurements = useWorktreeMeasurements(connected ? targets : []);
  const listPending =
    connected && supported && choices.refsQuery.data === null && choices.refsQuery.isPending;
  const listUnavailable = !connected || !supported || Boolean(choices.refsQuery.error);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- aggregate external measurement subscriptions and unregister them when a project leaves the scope
  useEffect(() => {
    onMeasurementsChange(project.physicalProjectKey, {
      search,
      measurements,
      pending: listPending,
      unavailable: listUnavailable,
    });
    return () => onMeasurementsChange(project.physicalProjectKey, null);
  }, [
    onMeasurementsChange,
    project.physicalProjectKey,
    search,
    measurements,
    listPending,
    listUnavailable,
  ]);
  const blockersByPath = new Map<string, readonly WorktreeSelectionBlocker[]>();
  const archivedReady =
    !choices.archived.isLoading && !choices.archived.error && activity.isSuccess;
  for (const row of visibleRows) {
    blockersByPath.set(
      row.worktreePath,
      worktreeSelectionBlockers({
        supported,
        containsProject: worktreeContainsProject(row.worktreePath, projectRoots),
        isIdle: row.isIdle,
        historyReady: archivedReady,
        historyError: choices.archived.error ?? activity.error,
        canRemove,
      }),
    );
  }
  const selectableTargets = targets.filter(
    (target) => blockersByPath.get(target.path)?.length === 0,
  );
  const selectedCount = selectableTargets.filter((target) =>
    selected.has(worktreeCleanupKey(target)),
  ).length;

  if (
    hideEmpty &&
    connected &&
    supported &&
    choices.refsQuery.data &&
    !choices.refsQuery.error &&
    visibleRows.length === 0
  )
    return null;

  return (
    <SettingsGroup>
      <div
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3",
          cleaning
            ? "@min-[42rem]/worktree-list:grid-cols-[1rem_0.75rem_minmax(0,1fr)_6rem_5.5rem_5rem_5rem_1.75rem]"
            : "@min-[42rem]/worktree-list:grid-cols-[0.75rem_minmax(0,1fr)_6rem_5.5rem_5rem_5rem_1.75rem]",
        )}
      >
        {cleaning ? (
          <WorktreeSelectionCheckbox
            name={`removable worktrees in ${title}, ${project.workspaceRoot}`}
            checked={selectableTargets.length > 0 && selectedCount === selectableTargets.length}
            indeterminate={selectedCount > 0 && selectedCount < selectableTargets.length}
            pending={pending}
            reason={
              selectableTargets.length === 0 ? "No selectable worktrees in this project." : null
            }
            onCheckedChange={(checked) => onSelectionChange(selectableTargets, checked)}
          />
        ) : null}
        <div
          className={cn(
            "min-w-0 space-y-1 @min-[42rem]/worktree-list:col-span-2",
            !cleaning && "col-span-2",
          )}
        >
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex min-w-0 items-baseline gap-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{project.workspaceRoot}</span>
            <span className="shrink-0">{project.environmentLabel}</span>
          </div>
        </div>
        <WorktreeColumnHelp label="Cleanup age">
          Elapsed 24-hour days under the enabled cleanup rules. Uses inactivity, time since all
          threads settled, or the lower age when both rules apply. Either enabled time rule can
          qualify a worktree for cleanup. Not settled means the settlement clock has not started.
          Other cleanup protections still apply.
        </WorktreeColumnHelp>
        <WorktreeColumnHelp label="Size">
          Estimated disk space reclaimable by removal. Shared files and dependency stores are
          excluded. Actual freed space may differ.
        </WorktreeColumnHelp>
        <WorktreeColumnHelp label="Threads" centered>
          Settled means all associated threads are settled under the cleanup rules, including
          archived threads. Subagents and side chats can inherit settlement from a parent in the
          same thread family, including separate worktrees. Active means at least one thread is not
          settled. No threads means none are associated. Deleted parent means dependent threads
          inherit a deleted parent. Loading or Unavailable means thread state could not yet be
          determined. Settled does not mean eligible for automatic cleanup.
        </WorktreeColumnHelp>
        <WorktreeColumnHelp label="Status" centered>
          Dirty means local files prevent automatic cleanup under the effective Keep worktrees with
          local changes policy. Clean means no files trigger that protection. Shared worktrees use
          the most protective policy among their associated projects. Busy means a thread has queued
          or active agent work. Unavailable means protection could not be checked. Clean does not
          mean eligible for automatic cleanup; age, settlement and other safeguards still apply.
        </WorktreeColumnHelp>
      </div>
      {!connected ? (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Environment offline. Reconnect to manage its worktrees.
        </p>
      ) : !supported ? (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Worktree management requires a compatible Fork server on this environment.
        </p>
      ) : choices.refsQuery.error ? (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {choices.refsQuery.error}
        </p>
      ) : choices.refsQuery.data === null ? (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Loading worktrees...
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {rows.length === 0 ? "No worktrees found." : "No matching worktrees."}
        </p>
      ) : (
        sortedRows.map((row) => (
          <ManagedWorktreeRow
            key={row.worktreePath}
            projectRef={projectRef}
            projectCwd={project.workspaceRoot}
            row={row}
            threads={choices.threads}
            protection={protectionByPath.get(row.worktreePath) ?? null}
            protectionUnavailable={!cleanupStatusSupported || Boolean(protection.error)}
            cleanupDetailsSupported={cleanupDetailsSupported}
            progress={progressByPath.get(row.worktreePath) ?? null}
            progressUnavailable={cleanupDetailsSupported && Boolean(progress.error)}
            threadsLabel={worktreeThreadsLabel(
              worktreeThreadsByPath.get(row.worktreePath),
              activity.isSuccess,
              Boolean(activity.error),
            )}
            archivedReady={archivedReady}
            now={now}
            cleaning={cleaning}
            selected={selected.has(
              worktreeCleanupKey({
                projectRef,
                projectCwd: project.workspaceRoot,
                path: row.worktreePath,
                name: row.dirName,
              }),
            )}
            pending={pending}
            selectionBlockers={blockersByPath.get(row.worktreePath) ?? []}
            measurement={
              measurements.get(
                worktreeCleanupKey({
                  projectRef,
                  projectCwd: project.workspaceRoot,
                  path: row.worktreePath,
                  name: row.dirName,
                }),
              ) ?? null
            }
            onSelectionChange={onSelectionChange}
          />
        ))
      )}
      {choices.archived.error || activity.error ? (
        <p role="alert" className="px-4 py-3 text-xs text-destructive">
          Unable to load thread history. Cleanup age and management actions are unavailable.
        </p>
      ) : null}
    </SettingsGroup>
  );
}

/** Keep workspace identity, Git state and thread inactivity distinct in each management row. */
function ManagedWorktreeRow({
  projectRef,
  projectCwd,
  row,
  threads,
  protection,
  protectionUnavailable,
  cleanupDetailsSupported,
  progress,
  progressUnavailable,
  threadsLabel,
  archivedReady,
  now,
  cleaning,
  selected,
  pending,
  selectionBlockers,
  measurement,
  onSelectionChange,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly projectCwd: string;
  readonly row: WorktreeRow;
  readonly threads: readonly OrchestrationV2ThreadShell[];
  readonly protection: ForkWorktreeCleanupStatusResult["worktrees"][number] | null;
  readonly protectionUnavailable: boolean;
  readonly cleanupDetailsSupported: boolean;
  readonly progress: ForkWorktreeCleanupProgress | null;
  readonly progressUnavailable: boolean;
  readonly threadsLabel: string;
  readonly archivedReady: boolean;
  readonly now: Date;
  readonly cleaning: boolean;
  readonly selected: boolean;
  readonly pending: boolean;
  readonly selectionBlockers: readonly WorktreeSelectionBlocker[];
  readonly measurement: WorktreeMeasurement | null;
  readonly onSelectionChange: (targets: readonly WorktreeCleanupTarget[], checked: boolean) => void;
}) {
  const color =
    useNamedWorktreeStore(
      (state) => state.worktrees[namedWorktreeKey(projectRef, row.worktreePath)]?.color,
    ) ?? DEFAULT_SOFT_PILL_COLOR;
  const busy = threads.some(
    (thread) =>
      (thread.worktreePath ?? projectCwd) === row.worktreePath && isWorktreeThreadRunning(thread),
  );
  const age = protection?.age;
  let inactivity = "Loading...";
  let ageDescription = "Checking the enabled cleanup clocks.";
  if (!cleanupDetailsSupported || protectionUnavailable) {
    inactivity = "Unavailable";
    ageDescription = "Cleanup age requires a compatible, connected Fork server.";
  } else if (age) {
    if (age.basis === "off") {
      inactivity = "Off";
      ageDescription = "Automatic cleanup is off for an associated project.";
    } else if (age.basis === "deleted") {
      inactivity = "Deleted";
      ageDescription =
        "The parent thread was deleted. Deletion cleanup applies without an age threshold; local protections still apply.";
    } else if (age.basis === "none") {
      inactivity = "Not timed";
      ageDescription = "No age-based cleanup rule is enabled. Other cleanup rules may still apply.";
    } else if (age.since === null) {
      inactivity = age.basis === "settled" ? "-" : "No threads";
      ageDescription =
        age.basis === "settled"
          ? "The settlement clock has not started because an associated thread is not settled."
          : "No associated thread activity starts the cleanup clock.";
    } else {
      inactivity = `${Math.max(0, Math.floor((now.getTime() - age.since) / 86_400_000))}d`;
      const clock =
        age.basis === "activity"
          ? "Last cleanup-relevant thread activity"
          : age.basis === "settled"
            ? "All threads settled, or their later activity"
            : "Lower of inactivity and settlement age";
      ageDescription = `${clock}: ${new Date(age.since).toLocaleString()}. Elapsed 24-hour days. Either enabled time rule can qualify the worktree; other protections still apply.`;
    }
  }
  let progressDescription: string | null = null;
  if (progressUnavailable) progressDescription = "Cleanup progress is unavailable.";
  else if (progress?.state === "checking")
    progressDescription = "Automatic cleanup is checking this worktree. Deletion has not started.";
  else if (progress?.state === "deleting")
    progressDescription = "Deletion is in progress. Branches and thread history are kept.";
  else if (progress?.state === "failed")
    progressDescription = `${progress.phase === "delete" ? "Deletion failed" : "Cleanup check failed before deletion"}: ${progress.reason ?? "Unknown error"}`;
  let statusLabel = "Loading...";
  if (busy) statusLabel = "Busy";
  else if (protectionUnavailable || protection?.status === "unavailable")
    statusLabel = "Unavailable";
  else if (protection) statusLabel = protection.status === "dirty" ? "Dirty" : "Clean";
  let statusDescription = "Checking local files against the cleanup policy.";
  if (busy) statusDescription = "Queued or active agent work prevents automatic cleanup.";
  else if (protectionUnavailable)
    statusDescription = "Cleanup protection is unavailable. A compatible Fork server is required.";
  else if (protection)
    statusDescription =
      protection.reason ?? "No local files prevent automatic cleanup under the current policy.";

  const target = { projectRef, projectCwd, path: row.worktreePath, name: row.dirName };
  let sizeLabel = measurement?.queued ? "Queued..." : "Measuring...";
  if (measurement?.error || (measurement && !measurement.pending && measurement.bytes === null))
    sizeLabel = "Unavailable";
  else if (measurement?.bytes !== null && measurement?.bytes !== undefined)
    sizeLabel = formatBytes(measurement.bytes);

  return (
    <div
      data-selected={cleaning && selected}
      className={cn(
        "grid items-center gap-3 px-4 py-3 data-[selected=true]:bg-accent/30",
        cleaning
          ? "grid-cols-[1rem_0.75rem_minmax(0,1fr)_auto] @min-[42rem]/worktree-list:grid-cols-[1rem_0.75rem_minmax(0,1fr)_6rem_5.5rem_5rem_5rem_1.75rem]"
          : "grid-cols-[0.75rem_minmax(0,1fr)_auto] @min-[42rem]/worktree-list:grid-cols-[0.75rem_minmax(0,1fr)_6rem_5.5rem_5rem_5rem_1.75rem]",
      )}
    >
      {cleaning ? (
        <WorktreeSelectionCheckbox
          name={row.dirName}
          checked={selected}
          reason={
            selectionBlockers.length > 0
              ? selectionBlockers.map((blocker) => blocker.reason).join("\n")
              : null
          }
          pending={pending}
          onCheckedChange={(checked) => onSelectionChange([target], checked)}
        />
      ) : null}
      <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate text-sm font-medium" />}>
              {row.dirName}
            </TooltipTrigger>
            <TooltipPopup>{row.worktreePath}</TooltipPopup>
          </Tooltip>
          {selectionBlockers.map((blocker) => (
            <Tooltip key={blocker.label}>
              <TooltipTrigger
                render={
                  <Badge
                    variant={blocker.label === "Error" ? "error" : "subtle"}
                    size="sm"
                    tabIndex={0}
                  />
                }
              >
                {blocker.label}
              </TooltipTrigger>
              <TooltipPopup>{blocker.reason}</TooltipPopup>
            </Tooltip>
          ))}
          {progressDescription !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    role="status"
                    aria-label={progressDescription}
                    className={cn(
                      "shrink-0",
                      progress?.state === "failed" || progressUnavailable
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  />
                }
              >
                {progress?.state === "deleting" ? (
                  <HourglassIcon aria-hidden className="size-3.5" />
                ) : progress?.state === "checking" ? (
                  <SearchIcon aria-hidden className="size-3.5" />
                ) : (
                  <CircleAlertIcon aria-hidden className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipPopup>{progressDescription}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{row.refName ?? "Detached HEAD"}</span>
        </span>
        <span className="text-xs text-muted-foreground @min-[42rem]/worktree-list:hidden">
          {inactivity} cleanup age · {sizeLabel} · {threadsLabel} · {statusLabel}
        </span>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="hidden text-right text-xs tabular-nums text-muted-foreground @min-[42rem]/worktree-list:block"
              tabIndex={0}
            />
          }
        >
          {inactivity}
        </TooltipTrigger>
        <TooltipPopup>{ageDescription}</TooltipPopup>
      </Tooltip>
      <span className="hidden text-right text-xs tabular-nums text-muted-foreground @min-[42rem]/worktree-list:block">
        {sizeLabel}
      </span>
      <span className="hidden text-center text-xs text-muted-foreground @min-[42rem]/worktree-list:block">
        {threadsLabel}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="hidden text-center text-xs text-muted-foreground @min-[42rem]/worktree-list:block"
              tabIndex={0}
            />
          }
        >
          {statusLabel}
        </TooltipTrigger>
        <TooltipPopup>{statusDescription}</TooltipPopup>
      </Tooltip>
      {cleaning ? (
        <span />
      ) : (
        <WorktreeActionsMenu
          projectRef={projectRef}
          projectCwd={projectCwd}
          row={row}
          threads={threads}
          archivedReady={archivedReady}
          standalone
          close={keepSettingsOpen}
        />
      )}
    </div>
  );
}

/** Row actions leave Settings open while the shared dialogs handle the operation. */
function keepSettingsOpen() {}

/** Keep column explanations available without repeating long copy in every row. */
function WorktreeColumnHelp({
  label,
  children,
  centered = false,
}: {
  readonly label: string;
  readonly children: string;
  readonly centered?: boolean;
}) {
  return (
    <div
      className={cn(
        "hidden @min-[42rem]/worktree-list:block",
        centered ? "justify-self-center" : "justify-self-end",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <span tabIndex={0} className="flex items-center gap-1 text-xs text-muted-foreground" />
          }
        >
          {label}
          <InfoIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>{children}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** Explain why a protected worktree is unavailable while retaining keyboard access to the reason. */
function WorktreeSelectionCheckbox({
  name,
  checked,
  reason,
  pending,
  indeterminate = false,
  onCheckedChange,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly reason: string | null;
  readonly pending: boolean;
  readonly indeterminate?: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const disabled = pending || reason !== null;
  const checkbox = (
    <Checkbox
      aria-label={`Select ${name}`}
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    />
  );
  if (!disabled) return checkbox;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} className="relative inline-flex cursor-not-allowed" />}
      >
        {checkbox}
        {!checked && !indeterminate ? (
          <LockKeyholeIcon
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto size-3 text-muted-foreground"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>{reason ?? "Deletion is in progress."}</TooltipPopup>
    </Tooltip>
  );
}
