import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";

import { useEnvironments } from "../state/environments";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  deleteTransientSideChat,
  selectStartupTransientSideChats,
  useTransientSideChatStore,
} from "../transientSideChatStore";

export function useDeleteTransientSideChat() {
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });

  return useCallback(
    async (ref: ScopedThreadRef) => {
      const result = await deleteTransientSideChat(ref, deleteThread);
      if (result._tag === "Failure") {
        console.warn("Failed to delete transient side chat; cleanup will retry later.", {
          environmentId: ref.environmentId,
          threadId: ref.threadId,
        });
      }
      return result;
    },
    [deleteThread],
  );
}

export function TransientSideChatCleanup() {
  const pendingByThreadKey = useTransientSideChatStore((state) => state.byThreadKey);
  const { environments } = useEnvironments();
  const deleteSideChat = useDeleteTransientSideChat();
  const inFlightRef = useRef(new Set<string>());
  const startupThreadKeysRef = useRef<ReadonlySet<string> | null>(null);
  if (startupThreadKeysRef.current === null) {
    startupThreadKeysRef.current = new Set(Object.keys(pendingByThreadKey));
  }

  useEffect(() => {
    const connectedEnvironmentIds = new Set(
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    );

    const ready = selectStartupTransientSideChats({
      startupThreadKeys: startupThreadKeysRef.current ?? new Set(),
      pendingByThreadKey,
      connectedEnvironmentIds,
      inFlightThreadKeys: inFlightRef.current,
    });
    for (const ref of ready) {
      const threadKey = scopedThreadKey(ref);
      inFlightRef.current.add(threadKey);
      void deleteSideChat(ref).finally(() => {
        inFlightRef.current.delete(threadKey);
      });
    }
  }, [deleteSideChat, environments, pendingByThreadKey]);

  return null;
}
