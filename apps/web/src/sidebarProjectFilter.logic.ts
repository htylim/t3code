import type { KeybindingCommand } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { shouldMountSidebarV2 } from "./components/AppSidebarLayout.logic";
import type { CommandPaletteActionItem } from "./components/CommandPalette.logic";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

export function isSidebarProjectFilterAvailable(input: {
  readonly sidebarV2Enabled: boolean;
  readonly pathname: string;
  readonly projectGroupCount: number;
}): boolean {
  return input.projectGroupCount > 0 && shouldMountSidebarV2(input);
}

export function handleSidebarProjectFilterShortcut(input: {
  readonly command: KeybindingCommand | null;
  readonly available: boolean;
  readonly event: {
    readonly repeat: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  };
  readonly open: () => void;
}): boolean {
  if (input.command !== "sidebar.projectFilter" || !input.available || input.event.repeat) {
    return false;
  }

  input.event.preventDefault();
  input.event.stopPropagation();
  input.open();
  return true;
}

export function buildSidebarProjectFilterActionItems(input: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly allProjectsIcon: ReactNode;
  readonly projectIcon: (group: SidebarProjectSnapshot) => ReactNode;
  readonly requestScope: (scopeKey: string | null) => void;
}): CommandPaletteActionItem[] {
  return [
    {
      kind: "action",
      value: "project-filter:all",
      searchTerms: ["all projects", "clear project filter"],
      title: "All projects",
      icon: input.allProjectsIcon,
      run: async () => {
        input.requestScope(null);
      },
    },
    ...input.groups.map(
      (group): CommandPaletteActionItem => ({
        kind: "action",
        value: `project-filter:${group.projectKey}`,
        searchTerms: [
          group.displayName,
          ...group.memberProjects.flatMap((project) => [project.title, project.workspaceRoot]),
        ],
        title: group.displayName,
        description: group.workspaceRoot,
        icon: input.projectIcon(group),
        run: async () => {
          input.requestScope(group.projectKey);
        },
      }),
    ),
  ];
}

export function resolveSidebarProjectFilterLabel(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  scopeKey: string | null,
): string {
  if (scopeKey === null) return "All projects";
  return groups.find((group) => group.projectKey === scopeKey)?.displayName ?? "All projects";
}
