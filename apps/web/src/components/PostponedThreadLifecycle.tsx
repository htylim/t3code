import { useEffect } from "react";

import { resumedPostponedThreadKeys, usePostponedThreadStore } from "../postponedThreadStore";
import { useThreadShells } from "../state/entities";

/** Restore postponed work after a user message commits, including sends from side chats. */
export function PostponedThreadLifecycle() {
  const threads = useThreadShells();
  const byThreadKey = usePostponedThreadStore((state) => state.byThreadKey);
  useEffect(() => {
    if (Object.keys(byThreadKey).length === 0) return;
    const resumedThreadKeys = resumedPostponedThreadKeys(threads, byThreadKey);
    if (resumedThreadKeys.length > 0) {
      usePostponedThreadStore.getState().restore(resumedThreadKeys);
    }
  }, [byThreadKey, threads]);
  return null;
}
