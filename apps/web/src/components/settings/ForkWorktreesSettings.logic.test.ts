import { expect, it } from "vite-plus/test";
import type { ForkWorktreeCleanupAge } from "@t3tools/contracts";

import {
  managedWorktreeRows,
  sortWorktreesByCleanupAge,
  worktreeThreadsLabel,
} from "./ForkWorktreesSettings.logic";

it("excludes the project checkout even when the project is a subdirectory or detached", () => {
  const rows = [
    { worktreePath: "/repo", dirName: "repo", refName: "fork", isBusy: false, isIdle: true },
    {
      worktreePath: "/trees/review",
      dirName: "review",
      refName: "review",
      isBusy: false,
      isIdle: true,
    },
  ];
  const refs = [{ worktreePath: "/repo", name: "fork", current: true, isDefault: false }];
  const managedRows = managedWorktreeRows(refs, rows, "/repo/apps/server");
  expect(managedRows).toEqual([rows[1]]);
  expect(managedWorktreeRows([{ ...refs[0]!, isDetached: true }], rows, "/repo")).toEqual([
    rows[1],
  ]);
  expect(managedWorktreeRows([], rows, "/repo")).toEqual([rows[1]]);
  expect(managedWorktreeRows([], rows, "/other-linked-checkout", "/repo")).toEqual([rows[1]]);
});

it("sorts numeric cleanup clocks youngest first, keeping ties and nonnumeric rows stable", () => {
  const paths = [
    "not-settled",
    "old-conversation",
    "new-conversation",
    "tie",
    "off",
    "no-clock",
    "deleted",
    "missing",
    "epoch-zero",
  ];
  const rows = paths.map((name) => ({
    worktreePath: `/trees/${name}`,
    dirName: name,
    refName: name,
    isBusy: false,
    isIdle: true,
  }));
  const ages = new Map<string, ForkWorktreeCleanupAge>([
    ["/trees/not-settled", { basis: "settled", since: null }],
    ["/trees/old-conversation", { basis: "settled", since: Date.parse("2026-11-04T12:00:00Z") }],
    ["/trees/new-conversation", { basis: "activity", since: Date.parse("2026-11-01T12:00:00Z") }],
    ["/trees/tie", { basis: "both", since: Date.parse("2026-11-01T12:00:00Z") }],
    ["/trees/off", { basis: "off", since: null }],
    ["/trees/no-clock", { basis: "none", since: null }],
    ["/trees/deleted", { basis: "deleted", since: null }],
    ["/trees/epoch-zero", { basis: "activity", since: 0 }],
  ]);
  expect(sortWorktreesByCleanupAge(rows, ages).map((row) => row.dirName)).toEqual([
    "old-conversation",
    "new-conversation",
    "tie",
    "epoch-zero",
    "not-settled",
    "off",
    "no-clock",
    "deleted",
    "missing",
  ]);
  expect(rows.map((row) => row.dirName)).toEqual(paths);
  expect(sortWorktreesByCleanupAge(rows, new Map())).toEqual(rows);
});

it("distinguishes thread settlement, no associations, and unavailable summaries", () => {
  const summary = { worktreePath: "/trees/review", latestActivityAt: 0 };
  expect(worktreeThreadsLabel({ ...summary, threadsSettled: false }, true, false)).toBe("Active");
  expect(worktreeThreadsLabel({ ...summary, threadsSettled: true }, true, false)).toBe("Settled");
  expect(worktreeThreadsLabel(undefined, true, false)).toBe("No threads");
  expect(worktreeThreadsLabel(undefined, false, false)).toBe("Loading...");
  expect(worktreeThreadsLabel(summary, true, false)).toBe("Unavailable");
  expect(worktreeThreadsLabel({ ...summary, threadsSettled: true }, true, true)).toBe(
    "Unavailable",
  );
});
