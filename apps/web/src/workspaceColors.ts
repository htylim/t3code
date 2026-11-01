import { type ScopedProjectRef, type ThreadId } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { getClientSettings } from "./hooks/useSettings";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { vcsEnvironment } from "./state/vcs";

/** Ask the destination environment to classify context using this device's color prompts. */
export async function chooseAutomaticWorkspaceColor(
  projectRef: ScopedProjectRef,
  context: { message?: string; threadId?: ThreadId },
): Promise<{ color: string; pending?: boolean }> {
  const settings = getClientSettings();
  const rules = settings.forkColorPickerPrompts;
  const fallbackColor = settings.forkWorkspaceFallbackColor;
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
