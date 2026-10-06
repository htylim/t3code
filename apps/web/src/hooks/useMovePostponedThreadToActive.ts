import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { usePostponedThreadStore } from "../postponedThreadStore";
import { readThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import * as ThreadUndo from "./threadUndo";

/** Clear underlying parking states before removing the local postponement preference. */
export function useMovePostponedThreadToActive() {
  const unsettleThread = useAtomCommand(threadEnvironment.unsettle, { reportFailure: false });
  const unsnoozeThread = useAtomCommand(threadEnvironment.unsnooze, { reportFailure: false });
  return useCallback(
    async (threadRef: ScopedThreadRef): Promise<boolean> => {
      const thread = readThreadShell(threadRef);
      if (!thread) return false;
      const commands = [];
      const threadKey = scopedThreadKey(threadRef);
      const commandInput = {
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, reason: "user" as const },
      };
      if (thread.snoozedUntil !== null) {
        ThreadUndo.invalidate("snooze", threadKey);
        commands.push(() => unsnoozeThread(commandInput));
      }
      if (thread.settledOverride === "settled") {
        ThreadUndo.invalidate("settle", threadKey);
        commands.push(() => unsettleThread(commandInput));
      }
      for (const command of commands) {
        const outcome = await command();
        if (outcome._tag === "Success") continue;
        if (!isAtomCommandInterrupted(outcome)) {
          const error = squashAtomCommandFailure(outcome);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not move thread to active",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      }
      usePostponedThreadStore.getState().restore([threadKey]);
      return true;
    },
    [unsnoozeThread, unsettleThread],
  );
}
