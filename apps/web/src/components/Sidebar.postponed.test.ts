import type { ContextMenuItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withPostponedThreadMenu } from "./Sidebar.postponed";
import {
  resolveSidebarDropTarget,
  resolveSidebarThreadSection,
  type SidebarListItem,
} from "./Sidebar.logic";

const threadMenu: ContextMenuItem<string>[] = [
  { id: "pin", label: "Pin" },
  { id: "settle", label: "Settle" },
  { id: "snooze", label: "Snooze" },
  { id: "rename", label: "Rename" },
  { id: "mark-unread", label: "Mark unread" },
  { id: "delete", label: "Delete" },
];

describe("Postponed sidebar behavior", () => {
  it("offers Postpone for active work alongside the existing Snooze action", () => {
    const menu = withPostponedThreadMenu(threadMenu, { activeCount: 1, postponedCount: 0 });
    expect(menu.map((entry) => entry.id)).toEqual([
      "pin",
      "postpone",
      "settle",
      "snooze",
      "rename",
      "mark-unread",
      "delete",
    ]);
    expect(withPostponedThreadMenu(threadMenu, { activeCount: 0, postponedCount: 0 })).toEqual(
      threadMenu,
    );
    expect(menu.find((entry) => entry.id === "postpone")?.label).toBe("Postpone");
  });

  it("offers Un-postpone alongside the normal thread actions", () => {
    const menu = withPostponedThreadMenu(threadMenu, { activeCount: 0, postponedCount: 1 });
    expect(menu.map((entry) => entry.id)).toEqual([
      "pin",
      "move-to-active",
      "settle",
      "snooze",
      "rename",
      "mark-unread",
      "delete",
    ]);
    expect(menu.find((entry) => entry.id === "move-to-active")?.label).toBe("Un-postpone");
  });

  it.each([
    ["settle", "Settle thread", "Postpone thread", "Un-postpone thread"],
    ["unsettle", "Un-settle thread", "Postpone thread", "Un-postpone thread"],
    ["unsettle", "Un-Settle Thread", "Postpone Thread", "Un-Postpone Thread"],
    ["unsettle", "Un-Settle", "Postpone", "Un-Postpone"],
  ])("matches the wording of %s labeled %s", (id, label, postponeLabel, unpostponeLabel) => {
    const menu = withPostponedThreadMenu([{ id, label }], {
      activeCount: 1,
      postponedCount: 1,
    });
    expect(menu.find((entry) => entry.id === "postpone")?.label).toBe(postponeLabel);
    expect(menu.find((entry) => entry.id === "move-to-active")?.label).toBe(unpostponeLabel);
  });

  it("counts each actionable subset in a mixed bulk selection", () => {
    const bulkMenu = threadMenu.map((entry) =>
      entry.id === "settle" ? { ...entry, label: "Settle (5)" } : entry,
    );
    const menu = withPostponedThreadMenu(bulkMenu, {
      activeCount: 2,
      postponedCount: 3,
      bulk: true,
    });
    expect(menu.find((entry) => entry.id === "postpone")?.label).toBe("Postpone (2)");
    expect(menu.find((entry) => entry.id === "move-to-active")?.label).toBe("Un-postpone (3)");
    expect(menu.map((entry) => entry.id)).toContain("settle");
    expect(menu.map((entry) => entry.id)).toContain("snooze");
    expect(threadMenu.map((entry) => entry.id)).toContain("snooze");
  });

  it("keeps Postponed authoritative over snooze, automatic settlement and pins", () => {
    expect(
      resolveSidebarThreadSection({ postponed: true, snoozed: true, settled: true, pinned: true }),
    ).toBe("postponed");
    expect(
      resolveSidebarThreadSection({ postponed: false, snoozed: true, settled: true, pinned: true }),
    ).toBe("snoozed");
  });

  it("treats a collapsed Postponed section as a boundary, not an active drop slot", () => {
    const sidebar: SidebarListItem[] = [
      { kind: "marker", marker: "pinned-header" },
      { kind: "marker", marker: "pinned-divider" },
      { kind: "thread", key: "active", section: "active" },
      { kind: "marker", marker: "postponed-header" },
      { kind: "marker", marker: "settled-header" },
    ];
    expect(
      resolveSidebarDropTarget(sidebar, "active", "sidebar-marker-postponed-header"),
    ).toBeNull();
  });
});
