import { describe, expect, it } from "vite-plus/test";

import { shouldMountSidebarV2 } from "./AppSidebarLayout.logic";

describe("shouldMountSidebarV2", () => {
  it("mounts only when enabled outside Settings", () => {
    expect(shouldMountSidebarV2({ sidebarV2Enabled: true, pathname: "/" })).toBe(true);
    expect(shouldMountSidebarV2({ sidebarV2Enabled: true, pathname: "/environment/thread" })).toBe(
      true,
    );
    expect(shouldMountSidebarV2({ sidebarV2Enabled: false, pathname: "/" })).toBe(false);
    expect(shouldMountSidebarV2({ sidebarV2Enabled: true, pathname: "/settings" })).toBe(false);
    expect(
      shouldMountSidebarV2({ sidebarV2Enabled: true, pathname: "/settings/keybindings" }),
    ).toBe(false);
  });
});
