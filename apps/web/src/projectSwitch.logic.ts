import type { KeybindingCommand } from "@t3tools/contracts";

import { shouldMountDefaultSidebar } from "./components/AppSidebarLayout.logic";
import { requestSidebarProjectFilterScope } from "./sidebarProjectFilterBus";

export function showAllProjects(): void {
  requestSidebarProjectFilterScope(null);
}

export function handleShowAllProjectsShortcut(input: {
  readonly command: KeybindingCommand | null;
  readonly available: boolean;
  readonly blocked: boolean;
  readonly event: {
    readonly repeat: boolean;
    readonly isComposing: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  };
}): boolean {
  if (
    input.command !== "project.showAllProjects" ||
    !input.available ||
    input.blocked ||
    input.event.repeat ||
    input.event.isComposing
  ) {
    return false;
  }
  input.event.preventDefault();
  input.event.stopPropagation();
  showAllProjects();
  return true;
}

export function isProjectSwitchAvailable(input: {
  readonly legacySidebarEnabled: boolean;
  readonly pathname: string;
  readonly projectGroupCount: number;
}): boolean {
  return input.projectGroupCount > 1 && shouldMountDefaultSidebar(input);
}

export function handleProjectSwitchShortcut(input: {
  readonly command: KeybindingCommand | null;
  readonly available: boolean;
  readonly event: {
    readonly repeat: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  };
  readonly open: () => void;
}): boolean {
  if (input.command !== "project.switch" || !input.available || input.event.repeat) {
    return false;
  }

  input.event.preventDefault();
  input.event.stopPropagation();
  input.open();
  return true;
}

export async function switchProject(input: {
  readonly projectScopeKey: string;
  readonly startNewThread: () => Promise<void>;
  readonly requestProjectScope: (projectScopeKey: string) => void;
}): Promise<void> {
  await input.startNewThread();
  input.requestProjectScope(input.projectScopeKey);
}
