import type { ScopedThreadRef } from "@t3tools/contracts";

import { randomUUID } from "~/lib/utils";

/** Keeps preview ids stable on reload and separate between app windows. */
function readWindowId(): string {
  const newId = randomUUID();
  if (typeof window === "undefined") return newId;
  try {
    const storedId = window.sessionStorage.getItem("t3code:preview-window-id");
    if (storedId) return storedId;
    window.sessionStorage.setItem("t3code:preview-window-id", newId);
  } catch {
    // A renderer without session storage still needs independent preview tabs.
  }
  return newId;
}

const rendererId = readWindowId();

/** Desktop ids must distinguish environments and server restarts and windows; server tab ids are process-local. */
export function previewRuntimeTabId(
  threadRef: ScopedThreadRef,
  serverEpoch: string | null,
  tabId: string,
  windowId = rendererId,
): string {
  return JSON.stringify([
    threadRef.environmentId,
    threadRef.threadId,
    serverEpoch,
    tabId,
    windowId,
  ]);
}
