import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import {
  latestWorktreeActivity,
  managedWorktreeRows,
  sortWorktreesByActivity,
  worktreeInactivityDays,
} from "./ForkWorktreesSettings.logic";

/** Build activity fields without unrelated thread metadata. */
function activityThread(
  overrides: Partial<Parameters<typeof latestWorktreeActivity>[0][number]> = {},
) {
  return {
    worktreePath: "/trees/review",
    createdAt: DateTime.makeUnsafe("2026-10-01T12:00:00Z"),
    latestUserMessageAt: null,
    latestVisibleMessage: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    ...overrides,
  };
}

it("uses the most recent activity across all associated threads, regardless of creation order", () => {
  const latestActivity = DateTime.makeUnsafe("2026-11-03T12:00:00Z");
  const threads = [
    activityThread({ latestRunCompletedAt: latestActivity }),
    activityThread({ createdAt: DateTime.makeUnsafe("2026-11-01T12:00:00Z") }),
    activityThread({
      worktreePath: "/trees/other",
      latestRunStartedAt: DateTime.makeUnsafe("2026-11-04T12:00:00Z"),
    }),
  ];
  expect(latestWorktreeActivity(threads, "/trees/review", "/repo")).toBe(
    DateTime.toEpochMillis(latestActivity),
  );
  expect(latestWorktreeActivity(threads, "/trees/missing", "/repo")).toBeNull();
  const olderActivity = Date.parse("2026-10-10T12:00:00Z");
  const worktreeActivityByPath = new Map([["/trees/older-settled", olderActivity]]);
  expect(
    latestWorktreeActivity(threads, "/trees/older-settled", "/repo", worktreeActivityByPath),
  ).toBe(olderActivity);
});

it("includes user messages and running turns, and associates null worktree paths with the local checkout", () => {
  const userMessage = DateTime.makeUnsafe("2026-11-01T12:00:00Z");
  const runningTurn = DateTime.makeUnsafe("2026-11-02T12:00:00Z");
  const threads = [
    activityThread({
      worktreePath: null,
      latestUserMessageAt: userMessage,
      latestRunStartedAt: runningTurn,
    }),
  ];
  expect(latestWorktreeActivity(threads, "/repo", "/repo")).toBe(
    DateTime.toEpochMillis(runningTurn),
  );
  expect(latestWorktreeActivity(threads, "/trees/review", "/repo")).toBeNull();
});

it.each([
  ["2026-11-03T00:00:00", "2026-11-03T23:59:59", 0],
  ["2026-11-02T23:59:59", "2026-11-03T00:00:01", 1],
  ["2026-10-31T23:00:00", "2026-11-03T01:00:00", 3],
  ["2026-03-07T23:00:00", "2026-03-09T01:00:00", 2],
  ["2026-11-04T00:00:00", "2026-11-03T00:00:00", 0],
])("counts calendar days between %s and %s", (activity, now, expected) => {
  expect(worktreeInactivityDays(new Date(activity).getTime(), new Date(now))).toBe(expected);
});

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

it("sorts by newest thread activity, keeping ties stable and worktrees without threads last", () => {
  const paths = ["no-threads-a", "old", "new", "tie", "no-threads-b"];
  const rows = paths.map((path) => ({
    worktreePath: `/trees/${path}`,
    dirName: path,
    refName: path,
    isBusy: false,
    isIdle: true,
  }));
  const threads = [
    activityThread({ worktreePath: "/trees/old" }),
    activityThread({ worktreePath: "/trees/new" }),
    activityThread({
      worktreePath: "/trees/new",
      latestRunCompletedAt: DateTime.makeUnsafe("2026-11-04T12:00:00Z"),
    }),
    activityThread({
      worktreePath: "/trees/tie",
      latestUserMessageAt: DateTime.makeUnsafe("2026-11-04T12:00:00Z"),
    }),
  ];
  expect(sortWorktreesByActivity(rows, threads, "/repo").map((row) => row.dirName)).toEqual([
    "new",
    "tie",
    "old",
    "no-threads-a",
    "no-threads-b",
  ]);
  expect(rows.map((row) => row.dirName)).toEqual(paths);
});
