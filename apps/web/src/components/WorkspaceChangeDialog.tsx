import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";
import { WorktreeDirectoryName } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useId, useState } from "react";

import { useWorkspaceChoices } from "../hooks/useWorkspaceChoices";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { resolveWorktreeStatusWord } from "./BranchToolbar.logic";
import { WorktreeColorPicker } from "./WorktreeColorPicker";
import type { WorkspaceMenuProps } from "./WorkspaceMenu";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, Radio } from "./ui/radio-group";

export type WorkspaceChangeDialogProps = Pick<
  WorkspaceMenuProps,
  | "projectRef"
  | "projectCwd"
  | "activeWorktreePath"
  | "activeBranch"
  | "envLocked"
  | "canCreateWorktree"
  | "onNewWorktreeSelect"
  | "onUseWorktree"
  | "onOpenChange"
  | "selectionHint"
> & { pending: boolean; returnFocus?: HTMLElement | false | undefined };
const isWorktreeDirectoryName = Schema.is(WorktreeDirectoryName);
const newWorktreeChoice = "new-worktree";

/** Review a destination and apply it within the same modal, using the composer's workspace list. */
export function WorkspaceChangeDialog(props: WorkspaceChangeDialogProps) {
  const { rows, localRef, refsQuery } = useWorkspaceChoices(props);
  const colors = useNamedWorktreeStore((state) => state.worktrees);
  const currentPath = props.activeWorktreePath ?? props.projectCwd;
  const [destination, setDestination] = useState(currentPath);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_SOFT_PILL_COLOR);
  const nameInputId = useId();
  const creating = destination === newWorktreeChoice;
  const directoryName = name.trim();
  const invalidName = !!directoryName && !isWorktreeDirectoryName(directoryName);
  const unchanged = destination === currentPath;
  const invalidNewWorktree =
    creating &&
    (!directoryName || invalidName || props.canCreateWorktree === false || !props.activeBranch);
  const disabled = props.envLocked || unchanged || invalidNewWorktree;

  /** Apply only the reviewed destination; the controller rechecks permissions and thread state. */
  async function changeWorkspace() {
    if (disabled) return;
    const accepted = creating
      ? await props.onNewWorktreeSelect({ name: directoryName, color })
      : await props.onUseWorktree({ branch: null, worktreePath: destination });
    if (accepted !== false) props.onOpenChange?.(false);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange?.(open);
      }}
    >
      <DialogPopup showCloseButton={!props.pending} finalFocus={() => props.returnFocus ?? true}>
        <DialogHeader>
          <DialogTitle>Change worktree</DialogTitle>
          <DialogDescription>Choose the checkout this thread will use.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <RadioGroup
            aria-label="Destination workspace"
            value={destination}
            disabled={props.envLocked}
            onValueChange={(nextDestination) => setDestination(String(nextDestination))}
          >
            <label className="flex cursor-pointer items-center gap-3">
              <Radio value={props.projectCwd} />
              <span className="min-w-0 flex-1 text-sm">
                Local checkout
                <span className="block truncate text-xs text-muted-foreground">
                  {localRef?.name ?? props.projectCwd}
                </span>
              </span>
              {currentPath === props.projectCwd ? (
                <span className="text-xs text-muted-foreground">current</span>
              ) : null}
            </label>
            {rows.map((row) => (
              <label
                key={row.worktreePath}
                className="flex min-w-0 cursor-pointer items-center gap-3"
              >
                <Radio value={row.worktreePath} />
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      colors[namedWorktreeKey(props.projectRef, row.worktreePath)]?.color ??
                      DEFAULT_SOFT_PILL_COLOR,
                  }}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{row.dirName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.refName ?? "Detached HEAD"}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.worktreePath === currentPath
                    ? "current"
                    : resolveWorktreeStatusWord({ isBusy: row.isBusy, isDirty: false })}
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-3">
              <Radio
                value={newWorktreeChoice}
                disabled={props.canCreateWorktree === false || !props.activeBranch}
              />
              <span className="text-sm">New worktree</span>
            </label>
          </RadioGroup>
          {creating ? (
            <div className="grid gap-2">
              <Label htmlFor={nameInputId}>Worktree name</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={nameInputId}
                  value={name}
                  disabled={props.envLocked}
                  aria-invalid={invalidName}
                  onChange={(event) => setName(event.target.value)}
                />
                <WorktreeColorPicker color={color} disabled={props.envLocked} onChange={setColor} />
              </div>
              {invalidName ? (
                <p className="text-sm text-destructive">
                  Enter a directory name without path separators.
                </p>
              ) : null}
            </div>
          ) : null}
          {!unchanged ? (
            <div className="space-y-2 text-sm">
              <p>
                {creating
                  ? `Create worktree "${directoryName || "..."}" from branch "${props.activeBranch}" and move this thread to it.`
                  : "Move this thread to the selected checkout."}
              </p>
              {!creating ? (
                <p className="break-all text-xs text-muted-foreground">{destination}</p>
              ) : null}
              <p className="text-muted-foreground">
                Files and uncommitted changes will stay in the current checkout. They will not be
                transferred.
              </p>
            </div>
          ) : null}
          {props.selectionHint ? (
            <p role="status" className="text-sm text-muted-foreground">
              {props.selectionHint}
            </p>
          ) : null}
          {refsQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {refsQuery.error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onOpenChange?.(false)}
          >
            Cancel
          </Button>
          <Button disabled={disabled} onClick={() => void changeWorkspace()}>
            {props.pending ? "Changing worktree..." : "Change worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
