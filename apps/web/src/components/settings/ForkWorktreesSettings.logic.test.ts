import type { WorktreeMeasurement } from "./useWorktreeCleanup";
import { expect, it } from "vite-plus/test";
import type { ForkWorktreeCleanupAge } from "@t3tools/contracts";

import {
  managedWorktreeRows,
  worktreeTotalSpaceLabel,
  worktreeSelectionBlockers,
  type ProjectWorktreeMeasurements,
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

it("totals unique visible worktrees without hiding pending or failed measurements", () => {
  const ready = { bytes: 1024, pending: false, error: null };
  const project: ProjectWorktreeMeasurements = {
    search: "",
    pending: false,
    unavailable: false,
    measurements: new Map<string, WorktreeMeasurement>([
      ['["local","/trees/review"]', ready],
      ['["local","/trees/queued"]', { bytes: null, pending: true, error: null }],
      ['["local","/trees/failed"]', { bytes: null, pending: false, error: "Offline" }],
    ]),
  };
  const duplicate: ProjectWorktreeMeasurements = {
    ...project,
    measurements: new Map([['["local","/trees/review"]', ready]]),
  };
  expect(worktreeTotalSpaceLabel([project, duplicate])).toBe(
    "~1.00 KB total used · 1 pending · 1 unknown",
  );
  expect(worktreeTotalSpaceLabel([duplicate, duplicate])).toBe("~1.00 KB total used");
  const remote = {
    ...duplicate,
    measurements: new Map([['["remote","/trees/review"]', ready]]),
  };
  expect(worktreeTotalSpaceLabel([duplicate, remote])).toBe("~2.00 KB total used");
  expect(worktreeTotalSpaceLabel([duplicate, undefined])).toBe(
    "~1.00 KB total used · Loading worktrees...",
  );
  const unavailable = { ...duplicate, unavailable: true };
  expect(worktreeTotalSpaceLabel([unavailable])).toBeNull();
  expect(worktreeTotalSpaceLabel([unavailable, { ...remote, unavailable: true }])).toBeNull();
  expect(worktreeTotalSpaceLabel([unavailable, remote])).toBe("~1.00 KB total used");
  expect(worktreeTotalSpaceLabel([unavailable, undefined])).toBe(
    "~0 B total used · Loading worktrees...",
  );
  expect(worktreeTotalSpaceLabel([{ ...duplicate, measurements: new Map() }])).toBe(
    "~0 B total used",
  );
  expect(worktreeTotalSpaceLabel([undefined])).toBe("~0 B total used · Loading worktrees...");
  expect(
    worktreeTotalSpaceLabel([
      {
        ...duplicate,
        measurements: new Map([['["local","/trees/review"]', { ...ready, pending: true }]]),
      },
    ]),
  ).toBe("~0 B total used · 1 pending");
});

it("classifies deletion restrictions without treating loading as an error", () => {
  const available = {
    supported: true,
    containsProject: false,
    isIdle: true,
    historyReady: true,
    historyError: null,
    canRemove: true,
  };
  expect(worktreeSelectionBlockers(available)).toEqual([]);
  expect(
    worktreeSelectionBlockers({ ...available, containsProject: true }).map(
      (blocker) => blocker.label,
    ),
  ).toEqual(["Project"]);
  expect(
    worktreeSelectionBlockers({ ...available, isIdle: false }).map((blocker) => blocker.label),
  ).toEqual(["Busy"]);
  expect(
    worktreeSelectionBlockers({ ...available, historyReady: false }).map(
      (blocker) => blocker.label,
    ),
  ).toEqual(["Loading"]);
  expect(
    worktreeSelectionBlockers({
      ...available,
      historyError: "Connection failed",
      historyReady: false,
    }),
  ).toEqual([{ label: "Error", reason: "Unable to load thread history: Connection failed" }]);
  expect(
    worktreeSelectionBlockers({ ...available, canRemove: false }).map((blocker) => blocker.label),
  ).toEqual(["Read-only"]);
  expect(
    worktreeSelectionBlockers({ ...available, supported: false, historyReady: false }).map(
      (blocker) => blocker.label,
    ),
  ).toEqual(["Unsupported"]);
  expect(
    worktreeSelectionBlockers({
      ...available,
      containsProject: true,
      isIdle: false,
      canRemove: false,
    }).map((blocker) => blocker.label),
  ).toEqual(["Project", "Busy", "Read-only"]);
});
