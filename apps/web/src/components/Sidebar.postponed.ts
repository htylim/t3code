import { msg } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";
import type { ContextMenuItem } from "@t3tools/contracts";

/** Add parking actions with the sibling settlement label's wording and actionable counts. */
export function withPostponedThreadMenu(
  menu: readonly ContextMenuItem<string>[],
  selection: {
    readonly postponedCount: number;
    readonly activeCount: number;
    readonly bulk?: boolean;
  },
  resolve: MessageResolver = m,
): ContextMenuItem<string>[] {
  const settlementLabel = menu.find(
    (entry) => entry.id === "settle" || entry.id === "unsettle",
  )?.label;
  const defaultLabelSuffix = selection.bulk ? "" : " thread";
  const labelSuffix =
    settlementLabel?.replace(/^(?:Un-)?settle/i, "").replace(/\s*\(\d+\)$/, "") ??
    defaultLabelSuffix;
  const unpostponeVerb = settlementLabel?.startsWith("Un-Settle") ? "Un-Postpone" : "Un-postpone";
  const actions: ContextMenuItem<string>[] = [];
  if (selection.activeCount > 0) {
    actions.push({
      id: "postpone",
      label: selection.bulk
        ? resolve(msg("Postpone ({count})", { count: selection.activeCount }))
        : labelSuffix === " Thread"
          ? resolve(msg("Postpone Thread"))
          : labelSuffix
            ? resolve(msg("Postpone thread"))
            : resolve(msg("Postpone")),
      ...(selection.bulk ? {} : { icon: "arrow-down" }),
    });
  }
  if (selection.postponedCount > 0) {
    actions.push({
      id: "move-to-active",
      label: selection.bulk
        ? resolve(msg("Un-postpone ({count})", { count: selection.postponedCount }))
        : unpostponeVerb === "Un-Postpone"
          ? labelSuffix
            ? resolve(msg("Un-Postpone Thread"))
            : resolve(msg("Un-Postpone"))
          : labelSuffix
            ? resolve(msg("Un-postpone thread"))
            : resolve(msg("Un-postpone")),
      ...(selection.bulk ? {} : { icon: "arrow-up" }),
    });
  }
  const combinedMenu = [...menu];
  const insertionIndex = combinedMenu.findIndex(
    (entry) =>
      entry.id === "settle" ||
      entry.id === "rename" ||
      entry.id === "regenerate-title" ||
      entry.id === "mark-unread",
  );
  combinedMenu.splice(insertionIndex < 0 ? 0 : insertionIndex, 0, ...actions);
  return combinedMenu;
}
