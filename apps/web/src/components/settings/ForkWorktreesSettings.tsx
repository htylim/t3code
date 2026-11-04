import {
  supportsForkWorktrees,
  type OrchestrationV2ThreadShell,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { GitBranchIcon, InfoIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useWorkspaceChoices } from "../../hooks/useWorkspaceChoices";
import { namedWorktreeKey, useNamedWorktreeStore } from "../../namedWorktreeStore";
import { useAtomValue } from "@effect/atom-react";
import { formatBytes } from "../../lib/formatBytes";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { isWorktreeThreadRunning, type WorktreeRow } from "../BranchToolbar.logic";
import { WorktreeActionsMenu } from "../WorktreeActionsMenu";
import { Button } from "../ui/button";
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
  latestWorktreeActivity,
  managedWorktreeRows,
  worktreeInactivityDays,
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
      if (!environmentIds.has(project.environmentId)) continue;
      if (selectedMembers && !selectedMembers.has(project)) continue;
      projects.push({ project, title: group.displayName });
    }
  }

  return (
    <SettingsPageContainer width="expanded">
      <section
        className="@container/worktree-list space-y-4"
        aria-labelledby="fork-worktrees-heading"
      >
        <div className="space-y-1 px-3 sm:px-4">
          <h2 id="fork-worktrees-heading" className="text-base font-semibold">
            Worktrees
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
          {cleaning && selected.size > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    role="status"
                    aria-live="polite"
                    tabIndex={0}
                    className="min-w-0 truncate text-xs text-muted-foreground"
                  />
                }
              >
                <span className="@min-[48rem]/worktree-list:hidden">
                  {worktreeSpaceEstimate(selectedSizes, true)}
                </span>
                <span className="hidden @min-[48rem]/worktree-list:inline">
                  {selected.size} selected · {worktreeSpaceEstimate(selectedSizes)}
                </span>
              </TooltipTrigger>
              <TooltipPopup>
                {selected.size} selected · {worktreeSpaceEstimate(selectedSizes)}
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
  cleaning,
  selected,
  pending,
  onSelectionChange,
  projectRoots,
}: {
  readonly project: SidebarProjectGroupMember;
  readonly title: string;
  readonly search: string;
  readonly now: Date;
  readonly connected: boolean;
  readonly supported: boolean;
  readonly cleaning: boolean;
  readonly selected: ReadonlyMap<string, WorktreeCleanupTarget>;
  readonly pending: boolean;
  readonly onSelectionChange: (targets: readonly WorktreeCleanupTarget[], checked: boolean) => void;
  readonly projectRoots: readonly string[];
}) {
  const projectRef = { environmentId: project.environmentId, projectId: project.id };
  const choices = useWorkspaceChoices({
    projectRef,
    projectCwd: project.workspaceRoot,
    activeWorktreePath: null,
    activeBranch: null,
    includeUnnamed: true,
  });
  const canRemove = useAtomValue(
    vcsEnvironment.removeWorktree.permissionAtom(project.environmentId),
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

  const targets = visibleRows.map((row): WorktreeCleanupTarget => ({
    projectRef,
    projectCwd: project.workspaceRoot,
    path: row.worktreePath,
    name: row.dirName,
  }));
  const measurements = useWorktreeMeasurements(connected ? targets : []);
  const reasons = new Map<string, string | null>();
  const archivedReady = !choices.archived.isLoading && !choices.archived.error;
  for (const row of visibleRows) {
    let reason: string | null = null;
    if (!supported) reason = "Worktree management requires a compatible Fork server.";
    else if (worktreeContainsProject(row.worktreePath, projectRoots))
      reason = "Contains a project checkout and cannot be removed.";
    else if (!row.isIdle) reason = "An agent is running here. Stop it before cleanup.";
    else if (!archivedReady) reason = "Thread history must be available before cleanup.";
    else if (!canRemove) reason = "This connection cannot remove worktrees.";
    reasons.set(row.worktreePath, reason);
  }
  const selectableTargets = targets.filter((target) => reasons.get(target.path) === null);
  const selectedCount = selectableTargets.filter((target) =>
    selected.has(worktreeCleanupKey(target)),
  ).length;

  return (
    <SettingsGroup>
      <div
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3",
          cleaning
            ? "@min-[42rem]/worktree-list:grid-cols-[1rem_0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem_1.75rem]"
            : "@min-[42rem]/worktree-list:grid-cols-[0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem_1.75rem]",
        )}
      >
        {cleaning ? (
          <Checkbox
            aria-label={`Select removable worktrees in ${title}, ${project.workspaceRoot}`}
            checked={selectableTargets.length > 0 && selectedCount === selectableTargets.length}
            indeterminate={selectedCount > 0 && selectedCount < selectableTargets.length}
            disabled={pending || selectableTargets.length === 0}
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
        <WorktreeColumnHelp label="Inactivity">
          Calendar days since the latest activity in any associated thread.
        </WorktreeColumnHelp>
        <WorktreeColumnHelp label="Size">
          Estimated disk space reclaimable by removal. Shared files and dependency stores are
          excluded. Actual freed space may differ.
        </WorktreeColumnHelp>
        <span className="hidden text-center text-xs text-muted-foreground @min-[42rem]/worktree-list:block">
          Status
        </span>
      </div>
      {connected && supported && choices.refsQuery.data && visibleRows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No matching worktrees.</p>
      ) : null}
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
      ) : choices.refsQuery.data.refs.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No Git worktrees found.</p>
      ) : (
        visibleRows.map((row) => (
          <ManagedWorktreeRow
            key={row.worktreePath}
            projectRef={projectRef}
            projectCwd={project.workspaceRoot}
            row={row}
            threads={choices.threads}
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
            selectionReason={reasons.get(row.worktreePath) ?? null}
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
      {choices.archived.error ? (
        <p role="alert" className="px-4 py-3 text-xs text-destructive">
          Unable to load thread history. Inactivity and management actions are unavailable.
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
  archivedReady,
  now,
  cleaning,
  selected,
  pending,
  selectionReason,
  measurement,
  onSelectionChange,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly projectCwd: string;
  readonly row: WorktreeRow;
  readonly threads: readonly OrchestrationV2ThreadShell[];
  readonly archivedReady: boolean;
  readonly now: Date;
  readonly cleaning: boolean;
  readonly selected: boolean;
  readonly pending: boolean;
  readonly selectionReason: string | null;
  readonly measurement: WorktreeMeasurement | null;
  readonly onSelectionChange: (targets: readonly WorktreeCleanupTarget[], checked: boolean) => void;
}) {
  const color =
    useNamedWorktreeStore(
      (state) => state.worktrees[namedWorktreeKey(projectRef, row.worktreePath)]?.color,
    ) ?? DEFAULT_SOFT_PILL_COLOR;
  const status = useEnvironmentQuery(
    vcsEnvironment.status({
      environmentId: projectRef.environmentId,
      input: { cwd: row.worktreePath, includeRemote: false },
    }),
  );
  const busy = threads.some(
    (thread) =>
      (thread.worktreePath ?? projectCwd) === row.worktreePath && isWorktreeThreadRunning(thread),
  );
  const activityAt = latestWorktreeActivity(threads, row.worktreePath, projectCwd);
  let inactivity = "Loading...";
  if (archivedReady)
    inactivity = activityAt === null ? "No threads" : `${worktreeInactivityDays(activityAt, now)}d`;
  const dirty = status.data !== null && status.data.workingTree.files.length > 0;
  let statusLabel = "Loading...";
  if (status.error) statusLabel = "Unavailable";
  else if (busy) statusLabel = "Busy";
  else if (status.data) statusLabel = dirty ? "Dirty" : "Clean";

  const target = { projectRef, projectCwd, path: row.worktreePath, name: row.dirName };
  let sizeLabel = "Measuring...";
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
          ? "grid-cols-[1rem_0.75rem_minmax(0,1fr)_auto] @min-[42rem]/worktree-list:grid-cols-[1rem_0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem_1.75rem]"
          : "grid-cols-[0.75rem_minmax(0,1fr)_auto] @min-[42rem]/worktree-list:grid-cols-[0.75rem_minmax(0,1fr)_5rem_5.5rem_5rem_1.75rem]",
      )}
    >
      {cleaning ? (
        <WorktreeSelectionCheckbox
          name={row.dirName}
          checked={selected}
          reason={selectionReason}
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
        </div>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{row.refName ?? "Detached HEAD"}</span>
        </span>
        <span className="text-xs text-muted-foreground @min-[42rem]/worktree-list:hidden">
          {activityAt === null ? inactivity : `${inactivity} inactive`} · {sizeLabel} ·{" "}
          {statusLabel}
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
        <TooltipPopup>
          {activityAt === null
            ? "No associated thread activity"
            : new Date(activityAt).toLocaleString()}
        </TooltipPopup>
      </Tooltip>
      <span className="hidden text-right text-xs tabular-nums text-muted-foreground @min-[42rem]/worktree-list:block">
        {sizeLabel}
      </span>
      <span className="hidden text-center text-xs text-muted-foreground @min-[42rem]/worktree-list:block">
        {statusLabel}
      </span>
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
}: {
  readonly label: string;
  readonly children: string;
}) {
  return (
    <div className="hidden justify-self-end @min-[42rem]/worktree-list:block">
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
  onCheckedChange,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly reason: string | null;
  readonly pending: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const checkbox = (
    <Checkbox
      aria-label={`Select ${name}`}
      checked={checked}
      disabled={pending || reason !== null}
      onCheckedChange={onCheckedChange}
    />
  );
  if (!reason) return checkbox;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />}>{checkbox}</TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}
