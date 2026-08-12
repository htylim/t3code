import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "./rightPanelStore";

export const SIDE_CHAT_REPLACEMENT_MESSAGE = "Replace current side chat?";

export async function confirmSideChatReplacement(input: {
  readonly owner: ScopedThreadRef;
  readonly nextTarget?: ScopedThreadRef;
  readonly confirm: (message: string) => Promise<boolean>;
}): Promise<boolean> {
  const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(input.owner)];
  const current = panel?.surfaces.find((surface) => surface.kind === "chat");
  if (!current) return true;

  if (
    input.nextTarget &&
    current.environmentId === input.nextTarget.environmentId &&
    current.threadId === input.nextTarget.threadId
  ) {
    return true;
  }

  return input.confirm(SIDE_CHAT_REPLACEMENT_MESSAGE);
}
