import {
  resolveEnvModeLabel,
  resolveCurrentWorkspaceLabel,
  resolveLockedWorkspaceLabel,
} from "./BranchToolbar.logic";
import { type VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  resolveBranchToolbarPrBranch,
  resolveLocalCheckoutBranchMismatch,
  resolveWorktreeRows,
  resolveWorktreeStatusWord,
  resolveWorktreeUnpushedWarning,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
  type WorktreeThreadState,
} from "./BranchToolbar.logic";

describe("resolveDraftEnvModeAfterBranchChange", () => {
  it("switches to local mode when returning from an existing worktree to the main worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: null,
        currentWorktreePath: "/repo/.t3/worktrees/feature-a",
        effectiveEnvMode: "worktree",
      }),
    ).toBe("local");
  });

  it("uses worktree mode when selecting a ref already attached to a worktree", () => {
    expect(
      resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: "/repo/.t3/worktrees/feature-a",
        currentWorktreePath: null,
        effectiveEnvMode: "local",
      }),
    ).toBe("worktree");
  });
});

describe("resolveBranchToolbarPrBranch", () => {
  it("hides PR state while an optimistic branch switch is in flight", () => {
    expect(
      resolveBranchToolbarPrBranch({
        activeThreadBranch: "feature/current",
        resolvedActiveBranch: "feature/next",
      }),
    ).toBeNull();
  });
});

describe("resolveLocalCheckoutBranchMismatch", () => {
  it("detects when a local thread is associated with a different branch than the checkout", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "local",
        activeWorktreePath: null,
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toEqual({
      threadBranch: "feature/thread",
      currentBranch: "feature/current",
    });
  });

  it("ignores dedicated worktrees because their checkout is already thread-scoped", () => {
    expect(
      resolveLocalCheckoutBranchMismatch({
        effectiveEnvMode: "worktree",
        activeWorktreePath: "/repo/.t3/worktrees/feature-thread",
        activeThreadBranch: "feature/thread",
        currentGitBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("resolveEffectiveEnvMode", () => {
  it("keeps a server thread in worktree mode while its worktree is still being created", () => {
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
        preparingWorktree: true,
      }),
    ).toBe("worktree");
    expect(
      resolveEffectiveEnvMode({
        activeWorktreePath: null,
        hasServerThread: true,
        draftThreadEnvMode: undefined,
      }),
    ).toBe("local");
  });
});

describe("resolveEnvModeLabel", () => {
  it("uses explicit workspace labels", () => {
    expect(resolveEnvModeLabel("local")).toBe("Current checkout");
    expect(resolveEnvModeLabel("worktree")).toBe("New worktree");
  });
});

describe("resolveCurrentWorkspaceLabel", () => {
  it("describes the main repo checkout when no worktree path is active", () => {
    expect(resolveCurrentWorkspaceLabel(null)).toBe("Current checkout");
  });

  it("shows the directory name of the attached worktree", () => {
    expect(resolveCurrentWorkspaceLabel("/repo/.t3/worktrees/feature-a")).toBe("feature-a");
  });
});

describe("worktree directory labels", () => {
  it.each([
    ["/repo/worktrees/feature-a/", "feature-a"],
    ["C:\\repo\\worktrees\\feature-b\\", "feature-b"],
  ])("uses the final directory in %s", (worktreePath, expectedName) => {
    expect(resolveCurrentWorkspaceLabel(worktreePath)).toBe(expectedName);
    expect(resolveLockedWorkspaceLabel(worktreePath, "worktree")).toBe(expectedName);
  });
});

describe("resolveLockedWorkspaceLabel", () => {
  it("keeps the checkout label when locked", () => {
    expect(resolveLockedWorkspaceLabel(null, "local")).toBe("Current checkout");
  });

  it("keeps the worktree name when locked", () => {
    expect(resolveLockedWorkspaceLabel("/repo/.t3/worktrees/feature-a", "worktree")).toBe(
      "feature-a",
    );
  });

  it("labels a worktree being created", () => {
    expect(resolveLockedWorkspaceLabel(null, "worktree")).toBe("New worktree");
  });
});

describe("deriveLocalBranchNameFromRemoteRef", () => {
  it("supports remote names that contain slashes", () => {
    expect(deriveLocalBranchNameFromRemoteRef("my-org/upstream/feature/demo")).toBe(
      "upstream/feature/demo",
    );
  });
});

describe("dedupeRemoteBranchesWithLocalMatches", () => {
  it("hides remote refs when the matching local ref exists", () => {
    const input: VcsRef[] = [
      {
        name: "feature/demo",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/demo",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "origin/feature/remote-only",
        isRemote: true,
        remoteName: "origin",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "feature/demo",
      "origin/feature/remote-only",
    ]);
  });

  it("keeps non-origin remote refs visible when git tracks with first-slash local naming", () => {
    const input: VcsRef[] = [
      {
        name: "upstream/feature",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
      {
        name: "my-org/upstream/feature",
        isRemote: true,
        remoteName: "my-org/upstream",
        current: false,
        isDefault: false,
        worktreePath: null,
      },
    ];

    expect(dedupeRemoteBranchesWithLocalMatches(input).map((ref) => ref.name)).toEqual([
      "upstream/feature",
      "my-org/upstream/feature",
    ]);
  });
});

describe("resolveBranchSelectionTarget", () => {
  it("reuses an existing secondary worktree for the selected ref", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: "/repo/.t3/worktrees/feature-b",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-b",
      nextWorktreePath: "/repo/.t3/worktrees/feature-b",
      reuseExistingWorktree: true,
    });
  });

  it("switches back to the main repo when the ref already lives there", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: true,
          worktreePath: "/repo",
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo",
      nextWorktreePath: null,
      reuseExistingWorktree: true,
    });
  });

  it("keeps checkout in the current worktree for non-default refs", () => {
    expect(
      resolveBranchSelectionTarget({
        activeProjectCwd: "/repo",
        activeWorktreePath: "/repo/.t3/worktrees/feature-a",
        refName: {
          isDefault: false,
          worktreePath: null,
        },
      }),
    ).toEqual({
      checkoutCwd: "/repo/.t3/worktrees/feature-a",
      nextWorktreePath: "/repo/.t3/worktrees/feature-a",
      reuseExistingWorktree: false,
    });
  });
});

describe("shouldIncludeBranchPickerItem", () => {
  it("keeps the synthetic checkout PR item visible for gh pr checkout input", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "__checkout_pull_request__:1359",
        normalizedQuery: "gh pr checkout 1359",
        createBranchItemValue: "__create_new_branch__:gh pr checkout 1359",
        checkoutPullRequestItemValue: "__checkout_pull_request__:1359",
      }),
    ).toBe(true);
  });

  it("surfaces an existing ref matching the sanitized query", () => {
    expect(
      shouldIncludeBranchPickerItem({
        itemValue: "new-branch",
        normalizedQuery: "new branch",
        createBranchItemValue: null,
        checkoutPullRequestItemValue: null,
      }),
    ).toBe(true);
  });
});

describe("sanitizeNewRefName", () => {
  it("collapses a run of whitespace into a single dash", () => {
    expect(sanitizeNewRefName("new   branch")).toBe("new-branch");
  });

  it("replaces tabs, which git rejects just like spaces", () => {
    expect(sanitizeNewRefName("new\tbranch")).toBe("new-branch");
  });

  it("preserves whitespace that git accepts", () => {
    expect(sanitizeNewRefName("new\u00a0branch")).toBe("new\u00a0branch");
    expect(sanitizeNewRefName("new\u2009branch")).toBe("new\u2009branch");
  });

  it("does not collapse dashes the user typed", () => {
    expect(sanitizeNewRefName("new - branch")).toBe("new---branch");
    expect(sanitizeNewRefName("foo--bar")).toBe("foo--bar");
  });
});

describe("workspace rows", () => {
  /** Builds only the ref fields consumed by the workspace list. */
  function ref(name: string, worktreePath: string, isRemote = false): VcsRef {
    return { name, worktreePath, isRemote, current: false, isDefault: false };
  }

  /** Defaults to the completed, unsettled subagent that caused false busy labels. */
  function worktreeThread(overrides: Partial<WorktreeThreadState> = {}): WorktreeThreadState {
    return {
      worktreePath: "/trees/alpha",
      archivedAt: null,
      settledOverride: null,
      relationshipToParent: "subagent",
      status: "completed",
      ...overrides,
    };
  }

  it("deduplicates local paths, keeps the selected worktree sorted and excludes main", () => {
    const rows = resolveWorktreeRows({
      refs: [
        ref("z", "/trees/zeta"),
        ref("a", "/trees/alpha"),
        ref("alias", "/trees/alpha"),
        ref("main", "/repo"),
        ref("current", "/current"),
        ref("remote", "/remote", true),
      ],
      threads: [],
      activeProjectCwd: "/repo",
      activeWorktreePath: "/current",
    });
    expect(rows.map((row) => row.dirName)).toEqual(["alpha", "current", "zeta"]);
    expect(rows.every((row) => !row.isBusy && row.isIdle)).toBe(true);
  });

  it("keeps a selected worktree visible in order while its ref is unavailable", () => {
    const rows = resolveWorktreeRows({
      refs: [ref("z", "/trees/zeta"), ref("a", "/trees/alpha")],
      threads: [],
      activeProjectCwd: "/repo",
      activeWorktreePath: "/trees/billing-fix",
      activeBranch: "feature/billing",
    });
    expect(rows.map((row) => row.dirName)).toEqual(["alpha", "billing-fix", "zeta"]);
    expect(rows[1]?.refName).toBe("feature/billing");
  });

  it("keeps detached worktrees at the same commit distinct without assigning a branch", () => {
    const rows = resolveWorktreeRows({
      refs: [
        { ...ref("deadbeef", "/trees/alpha"), isDetached: true },
        { ...ref("deadbeef", "/trees/beta"), isDetached: true },
        ref("feature/named", "/trees/named"),
      ],
      threads: [],
      activeProjectCwd: "/repo",
      activeWorktreePath: null,
    });
    expect(rows.map(({ worktreePath, refName }) => ({ worktreePath, refName }))).toEqual([
      { worktreePath: "/trees/alpha", refName: null },
      { worktreePath: "/trees/beta", refName: null },
      { worktreePath: "/trees/named", refName: "feature/named" },
    ]);
  });

  it("distinguishes busy idle threads, settled history and archived running turns", () => {
    const rows = resolveWorktreeRows({
      refs: [ref("busy", "/busy"), ref("settled", "/settled"), ref("archived", "/archived")],
      threads: [
        {
          worktreePath: "/busy",
          archivedAt: null,
          settledOverride: null,
          relationshipToParent: null,
          status: "completed",
        },
        {
          worktreePath: "/settled",
          archivedAt: null,
          settledOverride: "settled",
          relationshipToParent: null,
          status: "idle",
        },
        {
          worktreePath: "/archived",
          archivedAt: "2026-09-01",
          settledOverride: null,
          relationshipToParent: null,
          status: "running",
        },
      ],
      activeProjectCwd: "/repo",
      activeWorktreePath: null,
    });
    expect(rows.map(({ dirName, isBusy, isIdle }) => ({ dirName, isBusy, isIdle }))).toEqual([
      { dirName: "archived", isBusy: true, isIdle: false },
      { dirName: "busy", isBusy: true, isIdle: true },
      { dirName: "settled", isBusy: false, isIdle: true },
    ]);
  });

  it("releases worktrees with settled parents and completed hidden subagents", () => {
    const rows = resolveWorktreeRows({
      refs: [ref("alpha", "/trees/alpha"), ref("beta", "/trees/beta")],
      threads: [
        worktreeThread({ relationshipToParent: null, settledOverride: "settled" }),
        worktreeThread(),
        worktreeThread({ status: "idle" }),
        worktreeThread({
          worktreePath: "/trees/beta",
          relationshipToParent: null,
          settledOverride: "settled",
        }),
        worktreeThread({ worktreePath: "/trees/beta" }),
        worktreeThread({ worktreePath: null, relationshipToParent: null, status: "idle" }),
      ],
      activeProjectCwd: "/repo",
      activeWorktreePath: null,
    });

    expect(rows.map(({ dirName, isBusy, isIdle }) => ({ dirName, isBusy, isIdle }))).toEqual([
      { dirName: "alpha", isBusy: false, isIdle: true },
      { dirName: "beta", isBusy: false, isIdle: true },
    ]);
  });

  it.each(["idle", "completed", "failed", "interrupted", "cancelled", "rolled_back"] as const)(
    "does not reserve a worktree for a %s subagent",
    (status) => {
      const rows = resolveWorktreeRows({
        refs: [ref("alpha", "/trees/alpha")],
        threads: [worktreeThread({ status })],
        activeProjectCwd: "/repo",
        activeWorktreePath: null,
      });

      expect(rows[0]).toMatchObject({ isBusy: false, isIdle: true });
    },
  );

  it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
    "reserves a worktree for a %s subagent even when archived or settled",
    (status) => {
      const rows = resolveWorktreeRows({
        refs: [ref("alpha", "/trees/alpha")],
        threads: [worktreeThread({ status, archivedAt: "2026-10-07", settledOverride: "settled" })],
        activeProjectCwd: "/repo",
        activeWorktreePath: null,
      });

      expect(rows[0]).toMatchObject({ isBusy: true, isIdle: false });
    },
  );

  it.each([null, "fork"] as const)(
    "keeps an unsettled conversation with parent relationship %s busy between turns",
    (relationshipToParent) => {
      const rows = resolveWorktreeRows({
        refs: [ref("alpha", "/trees/alpha")],
        threads: [worktreeThread({ relationshipToParent })],
        activeProjectCwd: "/repo",
        activeWorktreePath: null,
      });

      expect(rows[0]).toMatchObject({ isBusy: true, isIdle: true });
    },
  );

  it.each([
    [true, true, "busy"],
    [true, false, "busy"],
    [false, true, "dirty"],
    [false, false, null],
  ] as const)("resolves busy=%s dirty=%s", (isBusy, isDirty, expected) => {
    expect(resolveWorktreeStatusWord({ isBusy, isDirty })).toBe(expected);
  });
});

describe("worktree removal upstream warning", () => {
  it("does not describe distance to the default branch as unpushed commits", () => {
    const status = { hasUpstream: false, aheadCount: 0, aheadOfDefaultCount: 1021 };
    expect(resolveWorktreeUnpushedWarning(status)).toBe("No upstream");
  });
  it("uses the tracked upstream count", () => {
    expect(resolveWorktreeUnpushedWarning({ hasUpstream: true, aheadCount: 3 })).toBe(
      "3 unpushed commits",
    );
  });
  it("does not invent a count before status loads", () => {
    expect(resolveWorktreeUnpushedWarning(null)).toBe("Unpushed commit count unavailable");
  });
});
