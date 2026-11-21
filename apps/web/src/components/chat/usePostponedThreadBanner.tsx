import { useGT, T } from "gt-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PauseIcon } from "lucide-react";
import { useMovePostponedThreadToActive } from "../../hooks/useMovePostponedThreadToActive";
import { usePostponedThreadStore } from "../../postponedThreadStore";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
/** Explain manual restoration and the same send-to-resume behavior as Snooze. */
export function usePostponedThreadBanner(
  threadRef: ScopedThreadRef | null,
): ComposerBannerStackItem | null {
  const gt = useGT();
  const isPostponed = usePostponedThreadStore(
    (state) => threadRef !== null && state.byThreadKey[scopedThreadKey(threadRef)] !== undefined,
  );
  const moveToActive = useMovePostponedThreadToActive();
  return (() => {
    if (!isPostponed || threadRef === null) return null;
    return {
      id: `thread-postponed:${scopedThreadKey(threadRef)}`,
      variant: "info",
      icon: <PauseIcon />,
      title: gt("This thread is postponed"),
      description: gt("Send a message to move it to active"),
      actions: (
        <Button size="xs" variant="ghost" onClick={() => void moveToActive(threadRef)}>
          <T>Un-postpone thread</T>
        </Button>
      ),
    };
  })();
}
