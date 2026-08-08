import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarProjectFilterLabel } from "./sidebarProjectFilter.logic";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

describe("resolveSidebarProjectFilterLabel", () => {
  const groups = [
    { projectKey: "project-one", displayName: "Project One" },
  ] as SidebarProjectSnapshot[];

  it("resolves the selected scope and falls back to All projects", () => {
    expect(resolveSidebarProjectFilterLabel(groups, "project-one")).toBe("Project One");
    expect(resolveSidebarProjectFilterLabel(groups, null)).toBe("All projects");
    expect(resolveSidebarProjectFilterLabel(groups, "missing")).toBe("All projects");
  });
});
