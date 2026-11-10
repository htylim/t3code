import type { ModelSelection, RuntimeMode, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef } from "react";
import { requestWorkspaceFocus } from "../../lib/workspaceFocus";

import { useComposerDraftStore } from "../../composerDraftStore";
import { newMessageId, newThreadId } from "~/lib/utils";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  readEnvironmentThreadRefs,
  readThreadShell,
  waitForThreadShell,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";

/**
 * Starts side chats from `threadRef`, or offers none when it is null. `open` forks the
 * thread's latest stable point, sends `prompt` there, and shows the side chat's tab.
 * With `draftPrompt`, reuses the newest side chat and appends the quote without sending. It
 * resolves false when the side chat did not start, or another one is still starting.
 */
export function useSideChat(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly readSettings: () => {
    readonly runtimeMode: RuntimeMode;
    readonly modelSelection: ModelSelection | undefined;
  };
  readonly onError: (message: string) => void;
}) {
  const pendingRef = useRef(false);
  const forkSideChat = useAtomCommand(threadEnvironment.forkSideChat, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const setThreadRuntimeMode = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const reportFailure = (
    failure: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
    fallback: string,
  ) => {
    if (isAtomCommandInterrupted(failure)) return;
    const error = squashAtomCommandFailure(failure);
    input.onError(error instanceof Error ? error.message : fallback);
  };
  const start = async (
    threadRef: ScopedThreadRef,
    prompt: string | undefined,
    draftPrompt?: string,
  ) => {
    const { runtimeMode, modelSelection } = input.readSettings();
    const targetThreadId = newThreadId();
    const fork = await forkSideChat({
      environmentId: threadRef.environmentId,
      input: { sourceThreadId: threadRef.threadId, targetThreadId, title: "Side chat" },
    });
    if (fork._tag === "Failure") {
      reportFailure(fork, "Could not start a side chat.");
      return false;
    }
    // Drops the empty side chat a failed start leaves behind; one that got its message stays.
    const discard = () =>
      void deleteThread({
        environmentId: threadRef.environmentId,
        input: { threadId: targetThreadId, onlyIfUnused: true },
      });
    const targetThreadRef = scopeThreadRef(threadRef.environmentId, targetThreadId);
    if (!(await waitForThreadShell(targetThreadRef))) {
      input.onError("The side chat was created, but it did not reach this client.");
      discard();
      return false;
    }
    const sideChat = readThreadShell(targetThreadRef);
    if (sideChat === null) {
      input.onError("The side chat is no longer available.");
      discard();
      return false;
    }
    if (runtimeMode !== sideChat.runtimeMode) {
      const mode = await setThreadRuntimeMode({
        environmentId: threadRef.environmentId,
        input: { threadId: targetThreadId, runtimeMode, createdAt: new Date().toISOString() },
      });
      if (mode._tag === "Failure") {
        reportFailure(mode, "Could not set the side chat's permission mode.");
        discard();
        return false;
      }
    }
    const text = prompt?.trim();
    // Send before showing the tab: closing a tab whose side chat has no run deletes it.
    if (text) {
      const turn = await startThreadTurn({
        environmentId: threadRef.environmentId,
        input: {
          threadId: targetThreadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          ...(modelSelection === undefined ? {} : { modelSelection }),
          titleSeed: deriveThreadTitleSeed({ text, attachments: [] }),
          runtimeMode,
          interactionMode: "default",
          createdAt: new Date().toISOString(),
        },
      });
      if (turn._tag === "Failure") {
        reportFailure(turn, "Could not send the side chat message.");
        discard();
        return false;
      }
    } else if (modelSelection !== undefined) {
      useComposerDraftStore.getState().setModelSelection(targetThreadRef, modelSelection);
    }
    if (draftPrompt !== undefined) {
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(threadRef.environmentId, targetThreadId), draftPrompt);
    }
    revealSideChat(threadRef, targetThreadId, draftPrompt !== undefined);
    return true;
  };
  const open = async (prompt?: string, options?: { readonly draftPrompt: string }) => {
    const { threadRef } = input;
    if (!threadRef || pendingRef.current) return false;
    pendingRef.current = true;
    if (options) {
      const sideChats = readEnvironmentThreadRefs(threadRef.environmentId)
        .map(readThreadShell)
        .filter((shell) => shell !== null)
        .filter(
          (shell) =>
            shell.lineage.sideChat === true &&
            shell.lineage.parentThreadId === threadRef.threadId &&
            shell.archivedAt === null,
        );
      const newestSideChat = sideChats.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )[0];
      if (newestSideChat) {
        const targetRef = scopeThreadRef(threadRef.environmentId, newestSideChat.id);
        const drafts = useComposerDraftStore.getState();
        const existingPrompt = drafts.getComposerDraft(targetRef)?.prompt ?? "";
        const separator = existingPrompt && !/\s$/.test(existingPrompt) ? " " : "";
        drafts.setPrompt(targetRef, `${existingPrompt}${separator}${options.draftPrompt}`);
        revealSideChat(threadRef, newestSideChat.id, true);
        pendingRef.current = false;
        return true;
      }
    }
    return start(threadRef, prompt, options?.draftPrompt).finally(() => {
      pendingRef.current = false;
    });
  };
  return { available: input.threadRef !== null, open: useStableCallback(open) };
}

/** Reveals the destination tab and waits for its composer to mount before focusing it. */
function revealSideChat(parentRef: ScopedThreadRef, threadId: ThreadId, focusComposer: boolean) {
  useRightPanelStore.getState().openSideChat(parentRef, threadId);
  if (focusComposer) {
    requestWorkspaceFocus({
      area: "panel",
      selector: `[data-side-chat-thread-id="${CSS.escape(threadId)}"] [contenteditable="true"]`,
    });
  }
}
