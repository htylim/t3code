import type { ScopedProjectRef } from "@t3tools/contracts";
import type { SidebarProjectSnapshot } from "./sidebarProjectGrouping";

export function resolveSidebarProjectFilterLabel(
  groups: ReadonlyArray<SidebarProjectSnapshot>,
  scopeKey: string | null,
): string {
  if (scopeKey === null) return "All projects";
  return groups.find((group) => group.projectKey === scopeKey)?.displayName ?? "All projects";
}

export function resolveSidebarNewChatAction(
  scopedProject: Pick<SidebarProjectSnapshot, "id" | "environmentId" | "memberProjectRefs"> | null,
  contextualProjectRef: ScopedProjectRef | null,
):
  | { command: "chat.new"; projectRef: null }
  | { command: "chat.newLocal"; projectRef: ScopedProjectRef | null } {
  if (scopedProject === null) {
    return { command: "chat.new", projectRef: null };
  }

  const contextualProject = contextualProjectRef
    ? scopedProject.memberProjectRefs.find(
        (projectRef) =>
          projectRef.environmentId === contextualProjectRef.environmentId &&
          projectRef.projectId === contextualProjectRef.projectId,
      )
    : null;
  const representativeProject = scopedProject.memberProjectRefs.find(
    (projectRef) =>
      projectRef.environmentId === scopedProject.environmentId &&
      projectRef.projectId === scopedProject.id,
  );

  return {
    command: "chat.newLocal",
    projectRef:
      contextualProject ?? representativeProject ?? scopedProject.memberProjectRefs[0] ?? null,
  };
}
