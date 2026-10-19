import { useAtomValue } from "@effect/atom-react";
import { GitCommandError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  VcsStatusResult,
  ScopedProjectRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { ChevronDownIcon, FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type MouseEventHandler,
} from "react";
import { requestConfirmDialog } from "../confirmDialog";
import {
  namedWorktreeKey,
  resolveNamedWorktreeColor,
  useNamedWorktreeStore,
  type NamedWorktreeSelection,
} from "../namedWorktreeStore";
import { NewWorktreeRow } from "./NewWorktreeRow";
import { requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { readLocalApi } from "../localApi";
import { shortcutLabelForCommand } from "../keybindings";
import { useThreadShellsForProjectRefs } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import {
  resolveCurrentWorkspaceLabel,
  resolveLockedWorkspaceLabel,
  resolveWorktreeRows,
  resolveWorktreeStatusWord,
  resolveWorktreeUnpushedWarning,
  type EnvMode,
  type PreviousWorktreeSeed,
  type WorktreeRow,
} from "./BranchToolbar.logic";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { revealInFileExplorerLabelForOs } from "./preview/fileExplorerLabel";
import { Button } from "./ui/button";
import { ComposerControl } from "./chat/ComposerControl";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
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
  forceNewWorktree?: boolean;
  canUseWorktree: boolean;
  effectiveEnvMode: EnvMode;
  onEnvModeChange: (mode: EnvMode) => void | Promise<boolean>;
  namedWorktreeSelection?: NamedWorktreeSelection | null;
  activeWorktreeColor?: string | null;
  onNewWorktreeSelect: (selection: NamedWorktreeSelection | null) => void | Promise<boolean>;
  onUseWorktree: (seed: PreviousWorktreeSeed) => void | Promise<boolean>;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchor?: ComponentProps<typeof MenuPopup>["anchor"];
  ariaLabel?: string;
  allowOpenWhenLocked?: boolean;
  selectionHint?: string | null;
  canCreateWorktree?: boolean;
  requireWorktreeName?: boolean;
  /** Standalone editing stays open until selection, Escape, or an outside click. */
  interactionMode?: "composer" | "standalone";
  environmentItems?: ReactNode;
  canChooseEnvironment?: boolean;
  displayMode?: "toolbar" | "panel";
  onContextMenu?: MouseEventHandler | undefined;
}
/** Share the Workspace picker across composer controls and existing-thread entry points. */
export function WorkspaceMenu(props: WorkspaceMenuProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.workspace",
  );
  const standalone = props.interactionMode === "standalone";
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const initialFocusPending = useRef(open);
  /** Controlled menus let thread context actions open this same picker at their click position. */
  function setOpen(nextOpen: boolean) {
    initialFocusPending.current = nextOpen;
    setInternalOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  }
  let workspaceLabel = resolveCurrentWorkspaceLabel(props.activeWorktreePath);
  if (props.forceNewWorktree) {
    workspaceLabel = "New worktree";
  } else if (props.envLocked) {
    workspaceLabel = resolveLockedWorkspaceLabel(props.activeWorktreePath, props.effectiveEnvMode);
  } else if (props.effectiveEnvMode === "worktree" && !props.activeWorktreePath) {
    workspaceLabel = "New worktree";
  }
  const triggerContent = props.trigger ?? (
    <>
      {props.activeWorktreePath ? (
        <FolderGitIcon className="size-3" />
      ) : props.effectiveEnvMode === "worktree" && (!props.envLocked || props.forceNewWorktree) ? (
        <FolderGit2Icon className="size-3" />
      ) : (
        <FolderIcon className="size-3" />
      )}
      <span
        data-composer-label
        className="min-w-0 max-w-[240px] group-data-[compact]/composer-context:max-w-0"
      >
        <span data-composer-label-motion className="block truncate">
          {workspaceLabel}
        </span>
      </span>
    </>
  );
  if (props.envLocked && !props.canChooseEnvironment && !props.allowOpenWhenLocked) {
    return (
      <span
        className="inline-flex h-7 min-w-0 items-center gap-1 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-xs sm:h-6"
        data-composer-context-control
        aria-label={props.displayMode === "panel" ? "Run context" : undefined}
        onContextMenu={props.onContextMenu}
      >
        {triggerContent}
      </span>
    );
  }
  return (
    <Menu
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (
          standalone &&
          !nextOpen &&
          (details.reason === "trigger-hover" || details.reason === "focus-out")
        ) {
          details.cancel();
          return;
        }
        setOpen(nextOpen);
      }}
    >
      {!props.anchor ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  props.displayMode === "panel" ? (
                    <ThreadDetailsControl part="select" />
                  ) : (
                    <ComposerControl size="xs" />
                  )
                }
                aria-label={
                  props.ariaLabel ?? (props.displayMode === "panel" ? "Run context" : "Workspace")
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onContextMenu={props.onContextMenu}
                onMouseDownCapture={(event) => {
                  if (props.displayMode === "panel" && event.ctrlKey && event.button === 0) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                data-composer-shortcut="composer.workspace"
                className={props.displayMode === "panel" ? undefined : "min-w-0 shrink"}
                data-composer-context-control
              >
                {triggerContent}
                {props.displayMode !== "panel" ? (
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
                ) : null}
              </MenuTrigger>
            }
          />
          <TooltipPopup side="top">
            {workspaceLabel}
            {shortcutLabel ? ` · ${shortcutLabel}` : null}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      <MenuPopup
        align="start"
        side="top"
        anchor={props.anchor}
        className="w-[440px] max-w-[calc(100vw-24px)]"
        {...(standalone ? {} : composerFloatingLayerProps)}
        onFocusCapture={(event) => {
          if (!initialFocusPending.current) return;
          initialFocusPending.current = false;
          // Menu's default focus chooses the editor before its selectable rows.
          const selectedOption = event.currentTarget.querySelector<HTMLElement>(
            "[data-workspace-initial-focus]",
          );
          if (selectedOption && selectedOption !== event.target) {
            // Ignore the original focus event after redirecting to the selected option.
            event.stopPropagation();
            selectedOption.focus({ preventScroll: true });
          }
        }}
      >
        {open ? <WorkspaceMenuContents {...props} close={() => setOpen(false)} /> : null}
      </MenuPopup>
    </Menu>
  );
}
/** Loads only checked-out local refs while the workspace popup is open. */
function WorkspaceMenuContents(
  props: WorkspaceMenuProps & {
    close: () => void;
  },
) {
  const refsQuery = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId: props.environmentId,
      input: { cwd: props.projectCwd, worktreesOnly: true },
    }),
  );
  const refs = refsQuery.data?.refs ?? [];
  const projectRefs = [props.projectRef];
  const liveThreads = useThreadShellsForProjectRefs(projectRefs);
  const archived = useArchivedThreadSnapshots([props.environmentId]);
  const threads = (() => {
    const byId = new Map<string, OrchestrationV2ThreadShell>();
    for (const snapshot of archived.snapshots) {
      for (const thread of snapshot.snapshot.threads) {
        if (thread.projectId === props.projectRef.projectId) byId.set(thread.id, thread);
      }
    }
    for (const thread of liveThreads) byId.set(thread.id, thread.source);
    return [...byId.values()];
  })();
  const namedWorktrees = useNamedWorktreeStore((state) => state.worktrees);
  useEffect(() => {
    useNamedWorktreeStore.getState().record(props.projectRef, threads);
  }, [props.projectRef, threads]);
  const rows = resolveWorktreeRows({
    refs,
    threads: threads.map((thread) => ({
      worktreePath: thread.worktreePath,
      archivedAt: thread.archivedAt === null ? null : "archived",
      settledOverride: thread.settledOverride,
      relationshipToParent: thread.lineage.relationshipToParent,
      status: thread.status,
    })),
    activeProjectCwd: props.projectCwd,
    activeWorktreePath: props.activeWorktreePath,
    activeBranch: props.activeBranch,
  }).filter(
    (row) =>
      row.worktreePath === props.activeWorktreePath ||
      resolveNamedWorktreeColor(
        row.worktreePath,
        namedWorktrees[namedWorktreeKey(props.projectRef, row.worktreePath)]?.color,
      ),
  );
  const localRef = refs.find((ref) => ref.worktreePath === props.projectCwd);
  return (
    <>
      {props.environmentItems}
      {props.selectionHint ? (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {props.selectionHint}
        </p>
      ) : null}
      <MenuRadioGroup value={props.activeWorktreePath ?? props.effectiveEnvMode}>
        <MenuGroup>
          <MenuGroupLabel>Workspace</MenuGroupLabel>
          <MenuRadioItem
            value="local"
            closeOnClick={false}
            data-workspace-initial-focus={
              !props.activeWorktreePath && props.effectiveEnvMode === "local" ? "" : undefined
            }
            disabled={props.envLocked}
            onClick={async () => {
              const accepted = props.activeWorktreePath
                ? await props.onUseWorktree({
                    branch: localRef?.isDetached ? null : (localRef?.name ?? null),
                    worktreePath: props.projectCwd,
                  })
                : await props.onEnvModeChange("local");
              if (accepted !== false) props.close();
            }}
          >
            <span className="flex items-center gap-2">
              <FolderIcon className="size-3" />
              <span className="flex-1 truncate">{props.projectCwd.split(/[\\/]/).at(-1)}</span>
              <span className="text-muted-foreground text-xs">
                {localRef?.isDetached ? "(detached)" : localRef?.name}
              </span>
              <span className="text-muted-foreground text-3xs">local checkout</span>
            </span>
          </MenuRadioItem>
          <NewWorktreeRow
            active={!props.activeWorktreePath && props.effectiveEnvMode === "worktree"}
            selection={props.namedWorktreeSelection ?? null}
            disabled={props.envLocked || props.canCreateWorktree === false}
            nameRequired={props.requireWorktreeName ?? false}
            onSelect={async (selection) => {
              const accepted = await props.onNewWorktreeSelect(selection);
              if (accepted !== false) props.close();
            }}
          />
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Worktrees</MenuGroupLabel>
          {rows.map((row) => (
            <WorkspaceRow
              key={row.worktreePath}
              {...props}
              row={row}
              current={row.worktreePath === props.activeWorktreePath}
              threads={threads}
              archivedReady={!archived.isLoading && !archived.error}
            />
          ))}
          {refsQuery.error ? (
            <div className="px-3 py-2 text-xs text-destructive">{refsQuery.error}</div>
          ) : null}
          {!rows.length && !refsQuery.isPending ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No named worktrees</div>
          ) : null}
        </MenuGroup>
      </MenuRadioGroup>
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
    <span className="text-3xs text-muted-foreground">
      {resolveWorktreeStatusWord({ isBusy, isDirty })}
    </span>
  );
}
/** Keep workspace actions independent of selection, using the shared editor for renaming. */
function WorkspaceRow(
  props: WorkspaceMenuProps & {
    row: WorktreeRow;
    threads: readonly OrchestrationV2ThreadShell[];
    current?: boolean;
    archivedReady: boolean;
    close: () => void;
  },
) {
  const { row } = props;
  const metadata = useNamedWorktreeStore(
    (state) => state.worktrees[namedWorktreeKey(props.projectRef, row.worktreePath)],
  );
  const color = resolveNamedWorktreeColor(row.worktreePath, metadata?.color);
  const composerFloatingLayerProps = useComposerMenuProps();
  const [actionsOpen, setActionsOpen] = useState(false);
  const statusQuery = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: row.worktreePath } }),
  );
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus);
  const localApi = readLocalApi();
  let renameReason: string | null = row.isIdle ? null : "An agent is running here";
  let removeReason: string | null = props.current ? "Can't remove the workspace you're in" : null;
  if (!row.isIdle && !removeReason) removeReason = "An agent is running here";
  if (!props.archivedReady) {
    if (!renameReason) renameReason = "Loading thread history";
    if (!removeReason) removeReason = "Loading thread history";
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
      // The menu has closed, so its row subscription may hold an old snapshot.
      // Force removal needs the files and unpushed commits that exist now.
      const refreshedStatus = await refreshStatus({
        environmentId: props.environmentId,
        input: { cwd: row.worktreePath },
      });
      const status = refreshedStatus._tag === "Success" ? refreshedStatus.value : null;
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
    useNamedWorktreeStore.getState().forget(props.projectRef, row.worktreePath);
    await refreshStatus({ environmentId: props.environmentId, input: { cwd: props.projectCwd } });
    props.close();
  }
  return (
    <MenuRadioItem
      closeOnClick={false}
      value={row.worktreePath}
      className="group/worktree"
      aria-current={props.current || undefined}
      data-workspace-initial-focus={props.current ? "" : undefined}
      aria-disabled={!props.canUseWorktree}
      onClick={async (event) => {
        if (
          !props.canUseWorktree ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        const accepted = await props.onUseWorktree({
          branch: row.refName,
          worktreePath: row.worktreePath,
        });
        if (accepted !== false) props.close();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setActionsOpen(true);
      }}
    >
      <span
        className={`grid items-center gap-2 ${
          props.current
            ? "grid-cols-[0.75rem_minmax(0,1fr)_minmax(0,8rem)_2.5rem_1.25rem]"
            : "grid-cols-[0.75rem_minmax(0,1fr)_minmax(0,8rem)_1.5rem_1.25rem]"
        }`}
      >
        {color ? (
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : (
          <FolderGitIcon className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{row.dirName}</span>
        <span className="min-w-0 truncate text-right text-xs text-muted-foreground">
          {row.refName ?? "(detached)"}
        </span>
        <span className="min-w-0 text-left">
          {props.current ? (
            <span className="text-3xs text-muted-foreground">current</span>
          ) : (
            <WorktreeRowStatus isBusy={row.isBusy} status={statusQuery.data} />
          )}
        </span>
        <Menu open={actionsOpen} onOpenChange={setActionsOpen}>
          <MenuTrigger
            aria-label={`Actions for ${row.dirName}`}
            render={<Button size="icon-micro" variant="ghost-muted" />}
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
            {...(props.interactionMode === "standalone" ? {} : composerFloatingLayerProps)}
          >
            <WorktreeAction
              reason={renameReason}
              onClick={() => {
                setActionsOpen(false);
                props.close();
                requestNamedWorktreeEdit({
                  projectRef: props.projectRef,
                  projectCwd: props.projectCwd,
                  worktreePath: row.worktreePath,
                });
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
      </span>
    </MenuRadioItem>
  );
}
