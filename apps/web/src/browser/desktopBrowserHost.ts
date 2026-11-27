import { useSyncExternalStore } from "react";

let hosting =
  typeof window === "undefined" ? false : (window.desktopBridge?.getServerBrowserHost?.() ?? true);
const listeners = new Set<() => void>();

/** Reports whether this renderer owns the environment's native browser tabs. */
export function hostsServerBrowser(): boolean {
  return hosting;
}

/** Updates all browser surfaces when the previous host window closes. */
export function startDesktopBrowserHostSync(): () => void {
  const update = (nextHosting: boolean) => {
    hosting = nextHosting;
    for (const listener of listeners) listener();
  };
  const unsubscribe = window.desktopBridge?.onServerBrowserHostChange?.(update) ?? (() => {});
  update(window.desktopBridge?.getServerBrowserHost?.() ?? true);
  return unsubscribe;
}

/** Subscribes to native browser ownership changes for this window. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps the native host and streamed browser surfaces in step with window ownership. */
export function useHostsServerBrowser(): boolean {
  return useSyncExternalStore(subscribe, hostsServerBrowser);
}
