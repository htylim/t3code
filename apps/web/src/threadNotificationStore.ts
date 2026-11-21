import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage, type StateStorage } from "./lib/storage";

export const THREAD_NOTIFICATION_STORAGE_KEY = "t3code:fork:thread-notifications:v1";

interface ThreadNotificationPreferences {
  readonly enabledThreadKeys: Record<string, true>;
  readonly setEnabled: (threadRef: ScopedThreadRef, enabled: boolean) => void;
}

/** Read only valid environment/thread keys from the device's saved choices. */
function readEnabledThreadKeys(persistedState: unknown): Record<string, true> {
  const enabledThreadKeys: Record<string, true> = {};
  if (persistedState === null || typeof persistedState !== "object") return enabledThreadKeys;
  if (!("enabledThreadKeys" in persistedState)) return enabledThreadKeys;
  const savedKeys = persistedState.enabledThreadKeys;
  if (savedKeys === null || typeof savedKeys !== "object") return enabledThreadKeys;
  for (const [threadKey, enabled] of Object.entries(savedKeys)) {
    if (enabled === true && parseScopedThreadKey(threadKey) !== null) {
      enabledThreadKeys[threadKey] = true;
    }
  }
  return enabledThreadKeys;
}

/** Persist notification choices on this client without changing server state. */
export function createThreadNotificationStore(storage: StateStorage) {
  return create<ThreadNotificationPreferences>()(
    persist(
      (set) => ({
        enabledThreadKeys: {},
        setEnabled: (threadRef, enabled) =>
          set((preferences) => {
            const enabledThreadKeys = { ...preferences.enabledThreadKeys };
            const threadKey = scopedThreadKey(threadRef);
            if (enabled) enabledThreadKeys[threadKey] = true;
            else delete enabledThreadKeys[threadKey];
            return { enabledThreadKeys };
          }),
      }),
      {
        name: THREAD_NOTIFICATION_STORAGE_KEY,
        storage: createJSONStorage(() => storage),
        partialize: (preferences) => ({ enabledThreadKeys: preferences.enabledThreadKeys }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          enabledThreadKeys: readEnabledThreadKeys(persistedState),
        }),
      },
    ),
  );
}

export const useThreadNotificationStore = createThreadNotificationStore(
  resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
);

/** Global settings take priority; selected threads override only Off. */
export function resolveThreadNotificationMode(
  globalMode: ClientSettings["notificationMode"],
  threadEnabled: boolean,
): ClientSettings["notificationMode"] {
  if (globalMode !== "off") return globalMode;
  return threadEnabled ? "notifications-and-sound" : "off";
}

/** Resolve the current mode again when an asynchronous notification is ready. */
export function getThreadNotificationMode(
  globalMode: ClientSettings["notificationMode"],
  threadRef: ScopedThreadRef,
) {
  return resolveThreadNotificationMode(
    globalMode,
    useThreadNotificationStore.getState().enabledThreadKeys[scopedThreadKey(threadRef)] === true,
  );
}
