import { describe, expect, it, vi } from "vite-plus/test";

import {
  requestSidebarProjectFilterScope,
  subscribeSidebarProjectFilterScope,
} from "./sidebarProjectFilterBus";

describe("sidebarProjectFilterBus", () => {
  it("delivers scope requests until the listener unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSidebarProjectFilterScope(listener);

    requestSidebarProjectFilterScope("project-group");
    requestSidebarProjectFilterScope(null);
    expect(listener.mock.calls).toEqual([["project-group"], [null]]);

    unsubscribe();
    requestSidebarProjectFilterScope("ignored");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
