import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "./rightPanelStore";
import { forgetTransientSideChat, registerTransientSideChat } from "./transientSideChatStore";

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

export function openSideChat(input: {
  readonly owner: ScopedThreadRef;
  readonly target: ScopedThreadRef;
  readonly transient: boolean;
}): ScopedThreadRef | null {
  if (scopedThreadKey(input.owner) === scopedThreadKey(input.target)) return null;

  const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(input.owner)];
  const current = panel?.surfaces.find((surface) => surface.kind === "chat");
  const replacedTransient =
    current?.transient === true &&
    (current.environmentId !== input.target.environmentId ||
      current.threadId !== input.target.threadId)
      ? { environmentId: current.environmentId, threadId: current.threadId }
      : null;

  if (input.transient) {
    registerTransientSideChat(input.target);
  } else {
    forgetTransientSideChat(input.target);
  }
  useRightPanelStore.getState().openChat(input.owner, input.target, { transient: input.transient });

  return replacedTransient;
}
