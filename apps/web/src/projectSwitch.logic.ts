import type { KeybindingCommand } from "@t3tools/contracts";

import { shouldMountSidebarV2 } from "./components/AppSidebarLayout.logic";

export function isProjectSwitchAvailable(input: {
  readonly sidebarV2Enabled: boolean;
  readonly pathname: string;
  readonly projectGroupCount: number;
}): boolean {
  return input.projectGroupCount > 1 && shouldMountSidebarV2(input);
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
