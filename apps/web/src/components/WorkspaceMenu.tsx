import { GitCommandError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type {
  EnvironmentId,
  OrchestrationThreadShell,
  VcsStatusResult,
  ScopedProjectRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { ChevronDownIcon, FolderGitIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import {
  useArchivedThreadSnapshots,
  refreshArchivedThreadsForEnvironment,
} from "../lib/archivedThreadsState";
import { readLocalApi } from "../localApi";
import { useThreadShellsForProjectRefs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import {
  resolveCurrentWorkspaceLabel,
  resolveWorktreeRows,
  resolveWorktreeStatusWord,
  resolveWorktreeUnpushedWarning,
  type EnvMode,
  type PreviousWorktreeSeed,
  type WorktreeRow,
} from "./BranchToolbar.logic";
import { composerFloatingLayerProps } from "./chat/composerEventScope";
import { revealInFileExplorerLabelForOs } from "./preview/fileExplorerLabel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";

const isGitCommandError = Schema.is(GitCommandError);

export interface WorkspaceMenuProps {
  environmentId: EnvironmentId;
  projectRef: ScopedProjectRef;
  projectCwd: string;
  activeWorktreePath: string | null;
  activeBranch: string | null;
  envLocked: boolean;
  canUseWorktree: boolean;
  effectiveEnvMode: EnvMode;
  onEnvModeChange: (mode: EnvMode) => void;
  onUseWorktree: (seed: PreviousWorktreeSeed) => void;
  trigger?: ReactNode;
  environmentItems?: ReactNode;
}

/** Shares the workspace popup between the wide and narrow composer controls. */
export function WorkspaceMenu(props: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={(nextOpen) => {
        if (!editing) setOpen(nextOpen);
      }}
    >
      <MenuTrigger
        render={<Button variant="ghost" size="xs" />}
        aria-label="Workspace"
        className="min-w-0 shrink font-normal text-muted-foreground/70 text-xs!"
        data-composer-context-control
      >
        {props.trigger ?? (
          <>
            {props.activeWorktreePath ? (
              <FolderGitIcon className="size-3" />
            ) : (
              <FolderIcon className="size-3" />
            )}
            <span
              data-composer-label
              className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
            >
              <span data-composer-label-motion className="block truncate">
                {props.effectiveEnvMode === "worktree" && !props.activeWorktreePath
                  ? "New worktree"
                  : resolveCurrentWorkspaceLabel(props.activeWorktreePath)}
              </span>
            </span>
          </>
        )}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        className="w-[440px] max-w-[calc(100vw-24px)]"
        {...composerFloatingLayerProps}
      >
        {open ? (
          <WorkspaceMenuContents {...props} setEditing={setEditing} close={() => setOpen(false)} />
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** Loads only checked-out local refs while the workspace popup is open. */
function WorkspaceMenuContents(
  props: WorkspaceMenuProps & { setEditing: (editing: boolean) => void; close: () => void },
) {
  const refsQuery = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId: props.environmentId,
      input: { cwd: props.projectCwd, worktreesOnly: true },
    }),
  );
  const refs = refsQuery.data?.refs ?? [];
  const projectRefs = useMemo(() => [props.projectRef], [props.projectRef]);
  const liveThreads = useThreadShellsForProjectRefs(projectRefs);
  const archived = useArchivedThreadSnapshots([props.environmentId]);
  const threads = useMemo(() => {
    const byId = new Map<string, OrchestrationThreadShell>();
    for (const snapshot of archived.snapshots) {
      for (const thread of snapshot.snapshot.threads) {
        if (thread.projectId === props.projectRef.projectId) byId.set(thread.id, thread);
      }
    }
    for (const thread of liveThreads) byId.set(thread.id, thread);
    return [...byId.values()];
  }, [archived.snapshots, liveThreads, props.projectRef.projectId]);
  const rows = resolveWorktreeRows({
    refs,
    threads,
    activeProjectCwd: props.projectCwd,
    activeWorktreePath: props.activeWorktreePath,
  });
  const localRef = refs.find((ref) => ref.worktreePath === props.projectCwd);
  const currentRow: WorktreeRow | null = props.activeWorktreePath
    ? {
        worktreePath: props.activeWorktreePath,
        dirName: props.activeWorktreePath.split(/[\\/]/).at(-1) ?? props.activeWorktreePath,
        refName: props.activeBranch ?? "",
        isBusy: false,
        isIdle: false,
      }
    : null;
  return (
    <>
      {props.environmentItems}
      <MenuRadioGroup value={props.activeWorktreePath ?? props.effectiveEnvMode}>
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          {currentRow ? (
            <WorkspaceRow
              {...props}
              row={currentRow}
              threads={threads}
              current
              archivedReady={!archived.isLoading && !archived.error}
            />
          ) : null}
          <MenuRadioItem
            value="local"
            disabled={props.envLocked}
            onClick={() => {
              if (props.activeWorktreePath)
                props.onUseWorktree({
                  branch: localRef?.name ?? null,
                  worktreePath: props.projectCwd,
                });
              else props.onEnvModeChange("local");
            }}
          >
            <span className="flex items-center gap-2">
              <FolderIcon className="size-3" />
              <span className="flex-1 truncate">{props.projectCwd.split(/[\\/]/).at(-1)}</span>
              <span className="text-muted-foreground text-xs">{localRef?.name}</span>
              <span className="text-muted-foreground text-[10px]">local checkout</span>
            </span>
          </MenuRadioItem>
          <MenuRadioItem
            value="worktree"
            disabled={props.envLocked}
            onClick={() => props.onEnvModeChange("worktree")}
          >
            <span className="flex items-center gap-2">
              <PlusIcon className="size-3" />
              New worktree
            </span>
          </MenuRadioItem>
        </MenuGroup>
      </MenuRadioGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuGroupLabel>Worktrees</MenuGroupLabel>
        {rows.map((row) => (
          <WorkspaceRow
            key={row.worktreePath}
            {...props}
            row={row}
            threads={threads}
            archivedReady={!archived.isLoading && !archived.error}
          />
        ))}
        {refsQuery.error ? (
          <div className="px-3 py-2 text-xs text-destructive">{refsQuery.error}</div>
        ) : null}
        {!rows.length && !refsQuery.isPending ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No other worktrees</div>
        ) : null}
      </MenuGroup>
    </>
  );
}

/** Explains disabled actions without letting the containing row select. */
function WorktreeAction(props: {
  reason: string | null;
  children: ReactNode;
  onClick: () => void;
}) {
  if (!props.reason)
    return (
      <MenuItem closeOnClick={false} onClick={props.onClick}>
        {props.children}
      </MenuItem>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>
        <MenuItem disabled>{props.children}</MenuItem>
      </TooltipTrigger>
      <TooltipPopup>{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

/** Gives busy precedence over the status fetched by its mounted worktree row. */
function WorktreeRowStatus({
  isBusy,
  status,
}: {
  isBusy: boolean;
  status: VcsStatusResult | null;
}) {
  const isDirty =
    !!status &&
    (status.workingTree.files.length > 0 ||
      status.aheadCount > 0 ||
      (!status.hasUpstream && (status.aheadOfDefaultCount ?? 0) > 0));
  return (
    <span className="text-[10px] text-muted-foreground">
      {resolveWorktreeStatusWord({ isBusy, isDirty })}
    </span>
  );
}

/** Keeps row actions independent of selection and preserves inline errors after rename. */
function WorkspaceRow(
  props: WorkspaceMenuProps & {
    row: WorktreeRow;
    threads: readonly OrchestrationThreadShell[];
    current?: boolean;
    archivedReady: boolean;
    setEditing: (editing: boolean) => void;
    close: () => void;
  },
) {
  const { row } = props;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(row.dirName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const statusQuery = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: row.worktreePath } }),
  );
  const renameWorktree = useAtomCommand(vcsEnvironment.renameWorktree, { reportFailure: false });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata);
  const localApi = readLocalApi();
  let renameReason: string | null = null;
  let removeReason: string | null = null;
  if (props.current) {
    renameReason = "Can't change the workspace you're in";
    removeReason = renameReason;
  } else {
    if (row.isBusy) renameReason = "Settle its threads first";
    if (!row.isIdle) removeReason = "An agent is running here";
    if (!props.archivedReady) {
      renameReason ??= "Loading thread history";
      removeReason ??= "Loading thread history";
    }
  }

  /** Leaves the row intact when focus moves away or Escape cancels editing. */
  function cancelRename() {
    if (pending) return;
    setRenaming(false);
    props.setEditing(false);
    setError(null);
  }

  /** Moves the worktree first, then updates every loaded live and archived thread. */
  async function commitRename() {
    if (pending) return;
    if (renameReason) {
      setError(renameReason);
      return;
    }
    if (
      !newName.trim() ||
      /[/\\]/.test(newName) ||
      newName === "." ||
      newName === ".." ||
      newName === row.dirName
    ) {
      setError("Enter a different directory name without path separators.");
      return;
    }
    setPending(true);
    const renamed = await renameWorktree({
      environmentId: props.environmentId,
      input: { cwd: props.projectCwd, path: row.worktreePath, newDirName: newName },
    });
    if (renamed._tag === "Failure") {
      const failure = Cause.squash(renamed.cause);
      setError(isGitCommandError(failure) ? failure.detail : String(failure));
      setPending(false);
      return;
    }
    for (const thread of props.threads) {
      if (thread.worktreePath !== row.worktreePath) continue;
      await updateMetadata({
        environmentId: props.environmentId,
        input: { threadId: thread.id, worktreePath: renamed.value.worktree.path },
      });
    }
    refreshArchivedThreadsForEnvironment(props.environmentId);
    setPending(false);
    setRenaming(false);
    props.setEditing(false);
  }

  /** Offers force removal only after Git refuses the initial non-force request. */
  async function remove() {
    setActionsOpen(false);
    props.close();
    const title = `Remove worktree "${row.dirName}"?`;
    const message = `${title}\n${row.worktreePath}\nThe branch is kept.`;
    if (
      !(await requestConfirmDialog(message, {
        variant: "destructive",
        confirmLabel: "Remove worktree",
      }))
    )
      return;
    const input = { cwd: props.projectCwd, path: row.worktreePath, force: false };
    let removed = await removeWorktree({ environmentId: props.environmentId, input });
    if (removed._tag === "Failure") {
      const failure = Cause.squash(removed.cause);
      if (!isGitCommandError(failure)) {
        toastManager.add({
          type: "error",
          title: "Unable to remove worktree",
          description: String(failure),
        });
        return;
      }
      const status = statusQuery.data;
      const details = [
        status
          ? `${status.workingTree.files.length} uncommitted files`
          : "Working tree status unavailable",
        resolveWorktreeUnpushedWarning(status),
        `${props.threads.filter((thread) => thread.worktreePath === row.worktreePath && thread.archivedAt === null).length} non-archived threads`,
      ];
      if (
        !(await requestConfirmDialog(message, {
          variant: "destructive",
          confirmLabel: "Force remove",
          details,
        }))
      )
        return;
      removed = await removeWorktree({
        environmentId: props.environmentId,
        input: { ...input, force: true },
      });
    }
    if (removed._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Unable to remove worktree",
        description: String(Cause.squash(removed.cause)),
      });
      return;
    }
    await refreshStatus({ environmentId: props.environmentId, input: { cwd: props.projectCwd } });
    props.close();
  }

  if (renaming)
    return (
      <div
        className="flex items-center gap-1 px-2 py-1"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span className="max-w-36 truncate text-xs text-muted-foreground">
          {row.worktreePath.slice(0, -row.dirName.length)}
        </span>
        <Tooltip open={!!error}>
          <TooltipTrigger
            render={
              <Input
                autoFocus
                aria-label={`Rename ${row.dirName}`}
                value={newName}
                readOnly={pending}
                aria-invalid={!!error}
                className={error ? "border-destructive" : ""}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setError(null);
                }}
                onBlur={cancelRename}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
              />
            }
          />
          <TooltipPopup>{error}</TooltipPopup>
        </Tooltip>
      </div>
    );

  return (
    <MenuItem
      closeOnClick={false}
      className="group/worktree flex gap-2"
      aria-disabled={!props.canUseWorktree}
      onClick={(event) => {
        if (
          !props.canUseWorktree ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        props.onUseWorktree({ branch: row.refName, worktreePath: row.worktreePath });
        props.close();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setActionsOpen(true);
      }}
    >
      <FolderGitIcon className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{row.dirName}</span>
      <span className="max-w-32 truncate text-xs text-muted-foreground">{row.refName}</span>
      {props.current ? (
        <span className="text-[10px] text-muted-foreground">current</span>
      ) : (
        <WorktreeRowStatus isBusy={row.isBusy} status={statusQuery.data} />
      )}
      <Menu open={actionsOpen} onOpenChange={setActionsOpen}>
        <MenuTrigger
          aria-label={`Actions for ${row.dirName}`}
          className="rounded px-1 text-[10px] opacity-25 group-hover/worktree:opacity-100 data-popup-open:bg-accent data-popup-open:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          ···
        </MenuTrigger>
        <MenuPopup
          align="end"
          onClick={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
          {...composerFloatingLayerProps}
        >
          <WorktreeAction
            reason={renameReason}
            onClick={() => {
              props.setEditing(true);
              setActionsOpen(false);
              setRenaming(true);
            }}
          >
            Rename…
          </WorktreeAction>
          <MenuItem
            onClick={() => {
              void writeTextToClipboard(row.worktreePath, "path").then(
                () => toastManager.add({ type: "success", title: "Path copied" }),
                (cause: unknown) => toastManager.add({ type: "error", title: String(cause) }),
              );
            }}
          >
            Copy path
          </MenuItem>
          {localApi?.shell.revealPath ? (
            <MenuItem
              onClick={() => {
                void localApi.shell.revealPath?.(row.worktreePath);
              }}
            >
              {revealInFileExplorerLabelForOs(
                navigator.platform.includes("Mac")
                  ? "darwin"
                  : navigator.platform.includes("Win")
                    ? "windows"
                    : "linux",
              )}
            </MenuItem>
          ) : null}
          <WorktreeAction
            reason={removeReason}
            onClick={() => {
              void remove();
            }}
          >
            Remove worktree…
          </WorktreeAction>
        </MenuPopup>
      </Menu>
    </MenuItem>
  );
}
