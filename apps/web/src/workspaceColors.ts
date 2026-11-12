import { type ScopedProjectRef, type ThreadId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { getClientSettings } from "./hooks/useSettings";
import { serverEnvironment } from "./state/server";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { vcsEnvironment } from "./state/vcs";

/** Read environment defaults, falling back to device preferences on older servers. */
export function getWorkspaceColorPreferences(projectRef: ScopedProjectRef) {
  const serverSettings = appAtomRegistry.get(
    serverEnvironment.settingsValueAtom(projectRef.environmentId),
  );
  const clientSettings = getClientSettings();
  return (
    serverSettings?.forkWorkspaceColors ?? {
      choice: clientSettings.forkDefaultWorkspaceColor,
      fallbackColor: clientSettings.forkWorkspaceFallbackColor,
      rules: clientSettings.forkColorPickerPrompts,
    }
  );
}

/** Only servers advertising persisted color support can replace client-side classification. */
export function supportsServerWorkspaceColors(projectRef: ScopedProjectRef): boolean {
  return (
    appAtomRegistry.get(serverEnvironment.settingsValueAtom(projectRef.environmentId))
      ?.forkWorkspaceColors !== undefined &&
    appAtomRegistry.get(serverEnvironment.configValueAtom(projectRef.environmentId))?.environment
      .capabilities.fork?.worktrees?.workspaceColors === true
  );
}

/** Ask the destination environment to classify context using its saved color rules. */
export async function chooseAutomaticWorkspaceColor(
  projectRef: ScopedProjectRef,
  context: { message?: string; threadId?: ThreadId },
): Promise<{ color: string; pending?: boolean }> {
  const { rules, fallbackColor } = getWorkspaceColorPreferences(projectRef);
  if (!rules.some((rule) => rule.prompt.trim()) && context.message?.trim())
    return { color: fallbackColor };
  const response = await runAtomCommand(
    appAtomRegistry,
    vcsEnvironment.chooseWorkspaceColor,
    {
      environmentId: projectRef.environmentId,
      input: {
        projectId: projectRef.projectId,
        ...context,
        ...(context.message !== undefined ? { message: context.message.slice(0, 16000) } : {}),
        rules,
        fallbackColor,
      },
    },
    { reportFailure: false, reportDefect: false },
  );
  return response._tag === "Success" ? response.value : { color: fallbackColor };
}
