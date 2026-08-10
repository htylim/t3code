import { describe, expect, it } from "vite-plus/test";

import { shouldMountDefaultSidebar } from "./AppSidebarLayout.logic";

describe("shouldMountDefaultSidebar", () => {
  it("mounts outside Settings unless the legacy sidebar is enabled", () => {
    expect(shouldMountDefaultSidebar({ legacySidebarEnabled: false, pathname: "/" })).toBe(true);
    expect(
      shouldMountDefaultSidebar({ legacySidebarEnabled: false, pathname: "/environment/thread" }),
    ).toBe(true);
    expect(shouldMountDefaultSidebar({ legacySidebarEnabled: true, pathname: "/" })).toBe(false);
    expect(shouldMountDefaultSidebar({ legacySidebarEnabled: false, pathname: "/settings" })).toBe(
      false,
    );
    expect(
      shouldMountDefaultSidebar({
        legacySidebarEnabled: false,
        pathname: "/settings/keybindings",
      }),
    ).toBe(false);
  });
});
