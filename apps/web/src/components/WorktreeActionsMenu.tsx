import { useAtomValue } from "@effect/atom-react";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import {
  AuthOrchestrationOperateScope,
  supportsForkWorktrees,
  GitCommandError,
  type OrchestrationV2ThreadShell,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { useState, type ReactNode } from "react";
import { requestConfirmDialog } from "../confirmDialog";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { useNamedWorktreeStore } from "../namedWorktreeStore";
import { useEnvironment } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { type WorktreeRow, resolveWorktreeUnpushedWarning } from "./BranchToolbar.logic";
import { requestNamedWorktreeEdit } from "./NamedWorktreeDialog";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { revealInFileExplorerLabelForOs } from "./preview/fileExplorerLabel";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";

const isGitCommandError = Schema.is(GitCommandError);

interface WorktreeActionsMenuProps {
  readonly projectRef: ScopedProjectRef;
  readonly projectCwd: string;
  readonly row: WorktreeRow;
  readonly threads: readonly OrchestrationV2ThreadShell[];
  readonly archivedReady: boolean;
  readonly current?: boolean;
  readonly standalone?: boolean;
  readonly close: () => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
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
/** Share worktree management and removal confirmations across the picker and Settings. */
export function WorktreeActionsMenu(props: WorktreeActionsMenuProps) {
  const { row } = props;
  const environmentId = props.projectRef.environmentId;
  const [internalOpen, setInternalOpen] = useState(false);
  const actionsOpen = props.open ?? internalOpen;
  /** Allow the picker row to open these actions on a context click. */
  function setActionsOpen(open: boolean) {
    setInternalOpen(open);
    props.onOpenChange?.(open);
  }
  const composerFloatingLayerProps = useComposerMenuProps();
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus);
  const canRemove = useAtomValue(vcsEnvironment.removeWorktree.permissionAtom(environmentId));
  const canRename = useAtomValue(vcsEnvironment.renameWorktree.permissionAtom(environmentId));
  const canUpdateThreads = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const environment = useEnvironment(environmentId);
  const localApi = readLocalApi();
  let renameReason: string | null = row.isIdle ? null : "An agent is running here";
  let removeReason: string | null = props.current ? "Can't remove the workspace you're in" : null;
  if (!row.isIdle && !removeReason) removeReason = "An agent is running here";
  if (!props.archivedReady) {
    if (!renameReason) renameReason = "Loading thread history";
    if (!removeReason) removeReason = "Loading thread history";
  }
  if (!supportsForkWorktrees(environment?.serverConfig?.environment.capabilities))
    renameReason = "Rename requires a compatible Fork server on this environment";
  if (!canRename || !canUpdateThreads) renameReason = "This connection cannot rename worktrees";
  if (!canRemove) removeReason = "This connection cannot remove worktrees";
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
    let removed = await removeWorktree({ environmentId, input });
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
        environmentId,
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
        environmentId,
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
    await refreshStatus({ environmentId, input: { cwd: props.projectCwd } });
    props.close();
  }
  return (
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
        {...(props.standalone ? {} : composerFloatingLayerProps)}
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
        {localApi?.shell.revealPath &&
        environment &&
        (environment.entry.target._tag === "PrimaryConnectionTarget" ||
          isDesktopLocalConnectionTarget(environment.entry.target)) ? (
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
        <MenuSeparator />
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
  );
}
