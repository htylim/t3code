import { useGT } from "gt-react";
import { TriangleAlertIcon } from "lucide-react";
import { msg, T, useMessages } from "gt-react";
import { useSyncExternalStore } from "react";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  respondToConfirmDialog,
  subscribeConfirmDialogHost,
} from "../confirmDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogAction,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import type { MessageResolver } from "../i18n/messages";

type ConfirmationCopy = {
  readonly title: string;
  readonly description: string | null;
};

// LocalApi.confirm takes one string; translated questions may end in a full-width mark.
const QUESTION_MARK = /[?？]/;

function resolveConfirmDialogCopy(message: string, resolve: MessageResolver): ConfirmationCopy {
  const normalizedMessage = message.trim();
  const lines = normalizedMessage.split("\n");
  const questionLineIndex = lines.findIndex((line) => QUESTION_MARK.test(line.trim().slice(-1)));

  if (questionLineIndex >= 0) {
    const title = lines[questionLineIndex]!.trim();
    const description = lines
      .filter((_, index) => index !== questionLineIndex)
      .join("\n")
      .trim();
    return { title, description: description || null };
  }

  const questionMarkIndex = normalizedMessage.search(QUESTION_MARK);
  if (questionMarkIndex >= 0) {
    return {
      title: normalizedMessage.slice(0, questionMarkIndex + 1).trim(),
      description: normalizedMessage.slice(questionMarkIndex + 1).trim() || null,
    };
  }

  return {
    title: resolve(msg("Confirm action")),
    description: normalizedMessage || resolve(msg("This action requires your confirmation.")),
  };
}

export function ConfirmDialogHost() {
  const gt = useGT();
  const m = useMessages();
  const state = useSyncExternalStore(
    subscribeConfirmDialogHost,
    readConfirmDialogState,
    readConfirmDialogState,
  );

  const copy = resolveConfirmDialogCopy(state.status === "idle" ? "" : state.message, m);
  const confirmVariant = state.status === "idle" ? "default" : state.variant;
  const focusConfirm = state.status !== "idle" && state.initialFocus === "confirm";
  const onCancel = () => respondToConfirmDialog(false);
  const onConfirm = () => respondToConfirmDialog(true);

  return (
    <AlertDialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeConfirmDialogClose();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          {copy.description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {copy.description}
            </AlertDialogDescription>
          ) : null}
          {state.status !== "idle" && state.worktrees ? (
            <ul
              aria-label={gt("Selected worktrees")}
              className="max-h-72 overflow-y-auto divide-y divide-border rounded-md border border-border text-left"
            >
              {state.worktrees.map((worktree) => (
                <li key={worktree.key} className="flex items-start gap-2 px-3 py-2">
                  {worktree.warning ? (
                    <TriangleAlertIcon
                      aria-label={gt("Protected local changes")}
                      className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                    />
                  ) : (
                    <span aria-hidden className="size-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{worktree.name}</p>
                    {worktree.warning ? (
                      <p className="text-xs text-warning-foreground">{worktree.warning}</p>
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <p className="truncate text-xs text-muted-foreground" tabIndex={0} />
                        }
                      >
                        {worktree.path}
                      </TooltipTrigger>
                      <TooltipPopup>{worktree.path}</TooltipPopup>
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {state.status !== "idle" && state.details ? (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          {focusConfirm && confirmVariant === "default" ? (
            <AlertDialogAction onClick={onConfirm}>
              {state.confirmLabel ?? <T>Confirm</T>}
            </AlertDialogAction>
          ) : (
            <Button variant={confirmVariant} onClick={onConfirm}>
              {state.status !== "idle" ? (state.confirmLabel ?? <T>Confirm</T>) : <T>Confirm</T>}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
