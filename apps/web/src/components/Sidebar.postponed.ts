import type { ContextMenuItem } from "@t3tools/contracts";

const POSTPONED_LIFECYCLE_ACTIONS = new Set([
  "pin",
  "unpin",
  "settle",
  "unsettle",
  "snooze",
  "unsnooze",
]);

/** Add fork parking actions without changing upstream's shared thread menu contract. */
export function withPostponedThreadMenu(
  menu: readonly ContextMenuItem<string>[],
  selection: {
    readonly postponedCount: number;
    readonly activeCount: number;
    readonly bulk?: boolean;
  },
): ContextMenuItem<string>[] {
  const actions: ContextMenuItem<string>[] = [];
  if (selection.activeCount > 0) {
    actions.push({
      id: "postpone",
      label: selection.bulk ? `Postpone (${selection.activeCount})` : "Postpone",
      ...(selection.bulk ? {} : { icon: "pause" }),
    });
  }
  if (selection.postponedCount > 0) {
    actions.push({
      id: "move-to-active",
      label: selection.bulk ? `Move to active (${selection.postponedCount})` : "Move to active",
      ...(selection.bulk ? {} : { icon: "play" }),
    });
  }
  const filteredMenu = menu.filter(
    (entry) => selection.postponedCount === 0 || !POSTPONED_LIFECYCLE_ACTIONS.has(entry.id),
  );
  const insertionIndex = filteredMenu.findIndex(
    (entry) =>
      entry.id === "settle" ||
      entry.id === "rename" ||
      entry.id === "regenerate-title" ||
      entry.id === "mark-unread",
  );
  filteredMenu.splice(insertionIndex < 0 ? 0 : insertionIndex, 0, ...actions);
  return filteredMenu;
}
