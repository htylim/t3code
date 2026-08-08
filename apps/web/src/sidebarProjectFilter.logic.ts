import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

export function resolveSidebarProjectFilterLabel(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  scopeKey: string | null,
): string {
  if (scopeKey === null) return "All projects";
  return groups.find((group) => group.projectKey === scopeKey)?.displayName ?? "All projects";
}
