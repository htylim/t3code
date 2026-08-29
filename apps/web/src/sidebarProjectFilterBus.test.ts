import { describe, expect, it, vi } from "vite-plus/test";

import {
  requestSidebarProjectFilterScope,
  requestSidebarProjectFilterScopeIfFiltered,
  subscribeSidebarProjectFilterScope,
  type SidebarProjectFilterScope,
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

  it("follows a new thread's project only when the sidebar is already filtered", () => {
    let currentScope: SidebarProjectFilterScope = null;
    const unsubscribe = subscribeSidebarProjectFilterScope((update) => {
      currentScope = typeof update === "function" ? update(currentScope) : update;
    });

    requestSidebarProjectFilterScopeIfFiltered("project-two");
    expect(currentScope).toBeNull();

    requestSidebarProjectFilterScope("project-one");
    requestSidebarProjectFilterScopeIfFiltered("project-two");
    expect(currentScope).toBe("project-two");

    unsubscribe();
  });
});
