import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useThreadShell } from "../state/entities";
import { useEnvironments } from "../state/environments";
import { threadTagEnvironment } from "../state/threadTags";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useDraftTagStore, type PendingDraftTag } from "../draftTagStore";

/** Finish durable draft transfers outside the composer, which can disappear during a send. */
export function DraftTagTransfers() {
  const pending = useDraftTagStore((state) => state.pendingByThreadKey);
  const drafts = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  useEffect(() => {
    useDraftTagStore.getState().prune(new Set(Object.keys(drafts)));
  }, [drafts]);
  return Object.entries(pending).map(([threadKey, transfer]) => (
    <DraftTagTransfer key={threadKey} transfer={transfer} />
  ));
}

/** Wait for a real thread, then write through its environment's existing guarded tag command. */
function DraftTagTransfer({ transfer }: { readonly transfer: PendingDraftTag }) {
  const { threadRef, tag } = transfer;
  const thread = useThreadShell(threadRef);
  const supported = useAtomValue(threadTagEnvironment.supportedAtom(threadRef.environmentId));
  const allowed = useAtomValue(threadTagEnvironment.set.permissionAtom(threadRef.environmentId));
  const snapshot = useAtomValue(threadTagEnvironment.snapshotAtom(threadRef.environmentId));
  const { presentationById } = useEnvironments();
  const connectionPhase = presentationById.get(threadRef.environmentId)?.connection.phase;
  const setTag = useAtomCommand(threadTagEnvironment.set, { reportFailure: false });
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (connectionPhase !== "connected" || !supported || !allowed) {
      attempted.current = null;
      return;
    }
    if (!thread || snapshot === null || inFlight.current) return;
    const complete = useDraftTagStore.getState().complete;
    // A replay must preserve a tag another device edited after creation.
    if (thread.deletedAt !== null || snapshot[threadRef.threadId] !== undefined) {
      complete(transfer);
      return;
    }
    const attemptKey = `${scopedThreadKey(threadRef)}:${retry}`;
    if (attempted.current === attemptKey) return;
    attempted.current = attemptKey;
    inFlight.current = true;
    void setTag({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tag },
    }).then((saved) => {
      inFlight.current = false;
      if (saved._tag === "Success") complete(transfer);
      else {
        // A reconnect can finish before the old request fails. Wake the new attempt without polling.
        if (attempted.current === null) setRetry((count) => count + 1);
        const error = squashAtomCommandFailure(saved);
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Could not apply the draft tag",
            description:
              error instanceof Error ? error.message : "The tag is saved locally for retry.",
            actionProps: { children: "Retry", onClick: () => setRetry((count) => count + 1) },
          }),
        );
      }
    });
  }, [
    allowed,
    connectionPhase,
    retry,
    setTag,
    snapshot,
    supported,
    tag,
    thread,
    threadRef,
    transfer,
  ]);
  return null;
}
