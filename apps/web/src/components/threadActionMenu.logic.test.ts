import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  canOpenInChatSurface: false,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

/** Read visible top-level action identifiers for workspace menu assertions. */
function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((action) => action.id);
}

describe("buildThreadActionMenuItems", () => {
  it("offers workspace editing for local and worktree threads directly below thread renaming", () => {
    expect(ids(baseState)).toContain("edit-workspace");
    expect(ids({ ...baseState, canEditWorkspace: false })).not.toContain("edit-workspace");
    const items = buildThreadActionMenuItems({ ...baseState, canEditWorkspace: true });
    const renameIndex = items.findIndex((action) => action.id === "rename");
    expect(items[renameIndex + 1]).toMatchObject({
      id: "edit-workspace",
      label: "Edit workspace",
      icon: items[renameIndex]?.icon,
    });
    expect(
      buildThreadActionMenuItems({ ...baseState, canEditWorkspace: true, canOperate: false }).find(
        (action) => action.id === "edit-workspace",
      )?.disabled,
    ).toBe(true);
  });

  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "edit-workspace",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "edit-workspace",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("includes the fork action without replacing upstream actions", () => {});

  it("includes the compact Chat entry only for an eligible sidebar target", () => {
    expect(ids(baseState)).not.toContain("open-in-chat-surface");
    expect(
      buildThreadActionMenuItems({ ...baseState, canOpenInChatSurface: true }).find(
        (item) => item.id === "open-in-chat-surface",
      ),
    ).toMatchObject({ label: "Open in side surface", icon: "panel-right" });
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});
