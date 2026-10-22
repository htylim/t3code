import { describe, expect, it } from "vite-plus/test";

import { resolveWorktreeDisplay } from "./worktreeDisplay";

const defaultColor = "#d3d3d3";

describe("worktree display", () => {
  it("excludes the local checkout and a worktree that has not been provisioned", () => {
    expect(resolveWorktreeDisplay({ worktreePath: null })).toBeNull();
    expect(resolveWorktreeDisplay({ worktreePath: "/repo", projectCwd: "/repo" })).toBeNull();
  });

  it.each(["t3-abcd1234", "t3code-abcd1234", "billing-fix"])(
    "shows %s without saved metadata",
    (directoryName) => {
      expect(resolveWorktreeDisplay({ worktreePath: `/trees/${directoryName}` })).toEqual({
        name: directoryName,
        color: defaultColor,
      });
    },
  );

  it("follows the actual directory when first-prompt naming moves an automatic worktree", () => {
    expect(resolveWorktreeDisplay({ worktreePath: "/trees/t3-abcd1234" })).toEqual({
      name: "t3-abcd1234",
      color: defaultColor,
    });
    expect(resolveWorktreeDisplay({ worktreePath: "/trees/fix-sidebar-pills" })).toEqual({
      name: "fix-sidebar-pills",
      color: defaultColor,
    });
  });

  it("preserves an existing explicit color", () => {
    expect(
      resolveWorktreeDisplay({ worktreePath: "/trees/billing-fix", savedColor: "#8b5cf6" }),
    ).toEqual({ name: "billing-fix", color: "#8b5cf6" });
  });

  it.each(["C:\\trees\\billing-fix", "C:\\trees\\billing-fix\\", "/trees/billing-fix/"])(
    "extracts the directory label from %s",
    (worktreePath) => {
      expect(resolveWorktreeDisplay({ worktreePath })).toEqual({
        name: "billing-fix",
        color: defaultColor,
      });
    },
  );
});
