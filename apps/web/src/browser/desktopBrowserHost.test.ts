import { afterEach, expect, it, vi } from "vite-plus/test";

import type { DesktopBridge } from "@t3tools/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("refreshes ownership after preload and follows later host transfers", async () => {
  let hosting = false;
  let transfer: ((hosting: boolean) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.stubGlobal("window", {
    desktopBridge: {
      getServerBrowserHost: () => hosting,
      onServerBrowserHostChange: (listener) => {
        transfer = listener;
        return unsubscribe;
      },
    } satisfies Pick<DesktopBridge, "getServerBrowserHost" | "onServerBrowserHostChange">,
  });
  const host = await import("./desktopBrowserHost");
  expect(host.hostsServerBrowser()).toBe(false);
  hosting = true;
  const stopSync = host.startDesktopBrowserHostSync();
  expect(host.hostsServerBrowser()).toBe(true);
  transfer?.(false);
  expect(host.hostsServerBrowser()).toBe(false);
  transfer?.(true);
  expect(host.hostsServerBrowser()).toBe(true);
  stopSync();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
