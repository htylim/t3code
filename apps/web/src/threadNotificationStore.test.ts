import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { createMemoryStorage } from "./lib/storage";
import {
  createThreadNotificationStore,
  resolveThreadNotificationMode,
  THREAD_NOTIFICATION_STORAGE_KEY,
} from "./threadNotificationStore";

it("persists choices by environment and supports turning them off after a restart", () => {
  const storage = createMemoryStorage();
  const preferences = createThreadNotificationStore(storage);
  const firstThread = scopeThreadRef(EnvironmentId.make("one"), ThreadId.make("thread"));
  const secondThread = scopeThreadRef(EnvironmentId.make("two"), ThreadId.make("thread"));
  preferences.getState().setEnabled(firstThread, true);
  const restored = createThreadNotificationStore(storage);
  expect(restored.getState().enabledThreadKeys).toEqual({ [scopedThreadKey(firstThread)]: true });
  expect(restored.getState().enabledThreadKeys[scopedThreadKey(secondThread)]).toBeUndefined();
  restored.getState().setEnabled(firstThread, false);
  expect(createThreadNotificationStore(storage).getState().enabledThreadKeys).toEqual({});
});

it("ignores malformed choices and refreshes choices removed in another tab", async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    THREAD_NOTIFICATION_STORAGE_KEY,
    JSON.stringify({
      state: { enabledThreadKeys: { "one:thread": true, invalid: true, "one:other": "true" } },
      version: 0,
    }),
  );
  const preferences = createThreadNotificationStore(storage);
  expect(preferences.getState().enabledThreadKeys).toEqual({ "one:thread": true });
  storage.removeItem(THREAD_NOTIFICATION_STORAGE_KEY);
  await preferences.persist.rehydrate();
  expect(preferences.getState().enabledThreadKeys).toEqual({});
});

it.each(["off", "notifications", "sound", "notifications-and-sound"] as const)(
  "keeps the global %s mode authoritative unless it is Off",
  (mode) => {
    expect(resolveThreadNotificationMode(mode, false)).toBe(mode);
    expect(resolveThreadNotificationMode(mode, true)).toBe(
      mode === "off" ? "notifications-and-sound" : mode,
    );
  },
);
