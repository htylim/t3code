import { getWorkspaceColorPreferences } from "../workspaceColors";
import { WorktreeActionsMenu } from "./WorktreeActionsMenu";
import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  VcsStatusResult,
  ScopedProjectRef,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  GitBranchIcon,
  HistoryIcon,
} from "lucide-react";
import {
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type MouseEventHandler,
} from "react";
import {
  namedWorktreeKey,
  useNamedWorktreeStore,
  type NamedWorktreeSelection,
} from "../namedWorktreeStore";
import { useWorkspaceChoices } from "../hooks/useWorkspaceChoices";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { NewWorktreeRow } from "./NewWorktreeRow";
import { shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import {
  resolveCurrentWorkspaceLabel,
  resolveLockedWorkspaceLabel,
  resolveRecentWorktreeRows,
  resolveWorktreeStatusWord,
  type EnvMode,
  type PreviousWorktreeSeed,
  type WorktreeRow,
} from "./BranchToolbar.logic";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { ComposerControl } from "./chat/ComposerControl";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSearchInput,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
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
  onNewWorktreeSelectionChange?: (selection: NamedWorktreeSelection | null) => void;
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
  const { refsQuery, archived, threads, rows, localRef } = useWorkspaceChoices(props);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const [query, setQuery] = useState("");
  const composerFloatingLayerProps = useComposerMenuProps();
  const recentRows = resolveRecentWorktreeRows(rows, threads);
  const selectedWorktreeName = props.activeWorktreePath
    ? resolveCurrentWorkspaceLabel(props.activeWorktreePath)
    : null;
  const searchText = query.trim().toLocaleLowerCase();
  const filteredRows = recentRows.filter(
    (row) =>
      row.dirName.toLocaleLowerCase().includes(searchText) ||
      row.refName?.toLocaleLowerCase().includes(searchText),
  );
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
            defaultColorChoice={getWorkspaceColorPreferences(props.projectRef).choice}
            active={!props.activeWorktreePath && props.effectiveEnvMode === "worktree"}
            selection={props.namedWorktreeSelection ?? null}
            disabled={props.envLocked || props.canCreateWorktree === false}
            nameRequired={props.requireWorktreeName ?? false}
            {...(props.onNewWorktreeSelectionChange
              ? { onSelectionChange: props.onNewWorktreeSelectionChange }
              : {})}
            onSelect={async (selection) => {
              const accepted = await props.onNewWorktreeSelect(selection);
              if (accepted !== false) props.close();
            }}
          />
        </MenuGroup>
        <MenuSub
          open={worktreesOpen}
          onOpenChange={(open) => {
            setWorktreesOpen(open);
            if (!open) setQuery("");
          }}
        >
          <MenuSubTrigger data-workspace-initial-focus={props.activeWorktreePath ? "" : undefined}>
            <HistoryIcon />
            <span className="min-w-0">
              <span className="block">Previous worktree</span>
              {selectedWorktreeName ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {selectedWorktreeName}
                </span>
              ) : null}
            </span>
          </MenuSubTrigger>
          <MenuSubPopup
            className="w-[400px] max-w-[calc(100vw-24px)] 2xl:w-[540px]"
            sideOffset={4}
            {...composerFloatingLayerProps}
          >
            {worktreesOpen ? (
              <>
                <MenuSearchInput
                  autoFocus
                  aria-label="Search worktrees"
                  placeholder="Search worktrees..."
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
                <div className="max-h-80 overflow-y-auto overscroll-contain">
                  <MenuRadioGroup value={props.activeWorktreePath ?? ""}>
                    {filteredRows.map((row) => (
                      <WorkspaceRow
                        key={row.worktreePath}
                        {...props}
                        row={row}
                        lastUsedAt={row.lastUsedAt}
                        current={row.worktreePath === props.activeWorktreePath}
                        threads={threads}
                        archivedReady={!archived.isLoading && !archived.error}
                      />
                    ))}
                  </MenuRadioGroup>
                  {refsQuery.error ? (
                    <div className="px-3 py-2 text-xs text-destructive">{refsQuery.error}</div>
                  ) : null}
                  {refsQuery.isPending && !refsQuery.data ? (
                    <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
                      Loading worktrees...
                    </div>
                  ) : !filteredRows.length && !refsQuery.error ? (
                    <div role="status" className="px-3 py-2 text-xs text-muted-foreground">
                      {query.trim() ? "No worktrees found" : "No named worktrees"}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </MenuSubPopup>
        </MenuSub>
      </MenuRadioGroup>
    </>
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
    lastUsedAt: number | null;
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
  const color = metadata?.color || DEFAULT_SOFT_PILL_COLOR;
  const [actionsOpen, setActionsOpen] = useState(false);
  const statusQuery = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId: props.environmentId, input: { cwd: row.worktreePath } }),
  );
  return (
    <MenuRadioItem
      closeOnClick={false}
      value={row.worktreePath}
      className="group/worktree"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setActionsOpen(true);
      }}
      aria-current={props.current || undefined}
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
    >
      <span className="grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)_auto_auto_1.25rem] items-start gap-x-2">
        {color ? (
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : (
          <FolderGitIcon className="mt-1 size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{row.dirName}</span>
          {row.refName !== row.dirName ? (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <GitBranchIcon aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{row.refName ?? "(detached)"}</span>
            </span>
          ) : null}
        </span>
        {props.lastUsedAt !== null ? (
          <time
            className="pt-0.5 text-xs text-muted-foreground"
            dateTime={new Date(props.lastUsedAt).toISOString()}
          >
            {formatRelativeTimeLabel(new Date(props.lastUsedAt).toISOString())}
          </time>
        ) : null}
        <span className="col-start-4 text-left">
          {props.current ? (
            <span className="text-3xs text-muted-foreground">current</span>
          ) : (
            <WorktreeRowStatus isBusy={row.isBusy} status={statusQuery.data} />
          )}
        </span>
        <WorktreeActionsMenu
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          projectRef={props.projectRef}
          projectCwd={props.projectCwd}
          row={row}
          threads={props.threads}
          archivedReady={props.archivedReady}
          current={props.current ?? false}
          standalone={props.interactionMode === "standalone"}
          close={props.close}
        />
      </span>
    </MenuRadioItem>
  );
}
