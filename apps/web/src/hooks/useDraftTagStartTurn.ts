import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  wasBootstrapThreadDeleted,
  wasBootstrapThreadNotCreated,
} from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { useComposerDraftStore, type ComposerThreadTarget } from "../composerDraftStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadTagsSupported, threadTagEnvironment } from "../state/threadTags";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useDraftTagStore } from "../draftTagStore";

/** Keep the draft strip available for clearing a selection after changing to an older server. */
export function useHasDraftTag(target: ComposerThreadTarget): boolean {
  const draftId = useComposerDraftStore((state) =>
    typeof target === "string" ? target : state.getDraftIdByRef(target),
  );
  return useDraftTagStore((state) => draftId !== null && state.byDraftId[draftId] !== undefined);
}

/** Stage the selected tag for each bootstrapped thread, including multi-model and background sends. */
export function useDraftTagStartTurn(target: ComposerThreadTarget) {
  const start = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return useCallback(
    async (request: Parameters<typeof start>[0]) => {
      const drafts = useComposerDraftStore.getState();
      const draftId = typeof target === "string" ? target : drafts.getDraftIdByRef(target);
      const tag = draftId ? useDraftTagStore.getState().byDraftId[draftId] : undefined;
      if (!request.input.bootstrap?.createThread || !tag) return start(request);
      if (
        !readThreadTagsSupported(request.environmentId) ||
        !appAtomRegistry.get(threadTagEnvironment.set.permissionAtom(request.environmentId))
      ) {
        return AsyncResult.failure(
          Cause.fail(
            new Error(
              "This connection cannot apply the draft's tag. Choose a supported environment or clear the tag before sending.",
            ),
          ),
        );
      }
      const threadRef = scopeThreadRef(request.environmentId, request.input.threadId);
      const tags = useDraftTagStore.getState();
      tags.stage(threadRef, tag);
      const pending = useDraftTagStore.getState().pendingByThreadKey[scopedThreadKey(threadRef)]!;
      const started = await start(request);
      if (started._tag === "Failure") {
        const error = squashAtomCommandFailure(started);
        if (wasBootstrapThreadDeleted(error) || wasBootstrapThreadNotCreated(error)) {
          tags.complete(pending);
        }
      }
      return started;
    },
    [start, target],
  );
}
