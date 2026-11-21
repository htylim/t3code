import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { msg } from "gt-react";
import { m } from "./i18n/messages";

import { toastManager } from "./components/ui/toast";
import { getClientSettings } from "./hooks/useSettings";
import { useThreadNotificationStore } from "./threadNotificationStore";
import { prepareThreadNotifications } from "./threadNotifications";

/** Toggle a device-local choice, enabling it only after system permission is granted. */
export async function toggleThreadNotifications(threadRef: ScopedThreadRef): Promise<void> {
  if (getClientSettings().notificationMode !== "off") return;
  const preferences = useThreadNotificationStore.getState();
  if (preferences.enabledThreadKeys[scopedThreadKey(threadRef)]) {
    preferences.setEnabled(threadRef, false);
    return;
  }
  const permissionError = await prepareThreadNotifications("notifications-and-sound");
  if (permissionError !== null) {
    toastManager.add({
      type: "error",
      title: m(msg("Could not enable notifications")),
      description: permissionError,
    });
    return;
  }
  if (getClientSettings().notificationMode === "off") {
    useThreadNotificationStore.getState().setEnabled(threadRef, true);
  }
}
