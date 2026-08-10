import type { OrchestrationThreadShell, ProviderInstanceId } from "@t3tools/contracts";

export type ComposerSlashCommand = "model" | "plan" | "default" | "fork";
export type StandaloneComposerSlashCommand = Exclude<ComposerSlashCommand, "model">;

export interface BuiltInComposerCommand {
  readonly id: string;
  readonly command: ComposerSlashCommand;
  readonly label: string;
  readonly description: string;
}

export type ThreadForkBlockReason =
  | "draft"
  | "missing"
  | "deleted"
  | "archived"
  | "unsupported-environment"
  | "unsupported-provider"
  | "missing-binding"
  | "work-in-flight"
  | "pending-request";

export type ThreadForkEligibility =
  | { readonly eligible: true }
  | {
      readonly eligible: false;
      readonly reason: ThreadForkBlockReason;
      readonly message: string;
    };

type ForkProvider = {
  readonly instanceId: ProviderInstanceId;
  readonly supportsThreadFork?: boolean;
};

export interface ThreadForkEligibilityInput {
  readonly routeKind: "server" | "draft";
  readonly thread: OrchestrationThreadShell | null;
  readonly deleted?: boolean;
  readonly environmentSupportsThreadFork: boolean;
  readonly providers?: ReadonlyArray<ForkProvider>;
  readonly providerSupportsThreadFork?: boolean;
  readonly queuedTurnCount: number;
}

const BLOCK_MESSAGES: Record<ThreadForkBlockReason, string> = {
  draft: "Send the first message before forking this draft thread.",
  missing: "This thread is not available to fork.",
  deleted: "Deleted threads cannot be forked.",
  archived: "Unarchive this thread before forking it.",
  "unsupported-environment":
    "This environment's server does not support thread forking. Update the server and try again.",
  "unsupported-provider": "This thread's provider does not support thread forking.",
  "missing-binding": "This thread does not have a resumable provider session to fork.",
  "work-in-flight": "Wait for the current thread work to finish before forking it.",
  "pending-request": "Resolve the pending approval or question before forking this thread.",
};

function blocked(reason: ThreadForkBlockReason): ThreadForkEligibility {
  return { eligible: false, reason, message: BLOCK_MESSAGES[reason] };
}

export function resolveThreadForkEligibility(
  input: ThreadForkEligibilityInput,
): ThreadForkEligibility {
  if (input.routeKind === "draft") return blocked("draft");
  if (input.thread === null) return blocked("missing");
  if (input.deleted === true) return blocked("deleted");
  if (input.thread.archivedAt !== null) return blocked("archived");
  if (!input.environmentSupportsThreadFork) return blocked("unsupported-environment");

  const boundProviderInstanceId = input.thread.session?.providerInstanceId;
  if (!boundProviderInstanceId) return blocked("missing-binding");
  const providerSupportsThreadFork =
    input.providerSupportsThreadFork ??
    input.providers?.find((provider) => provider.instanceId === boundProviderInstanceId)
      ?.supportsThreadFork ??
    false;
  if (!providerSupportsThreadFork) return blocked("unsupported-provider");

  if (
    input.thread.session?.status === "starting" ||
    input.thread.session?.status === "running" ||
    input.thread.latestTurn?.state === "running" ||
    input.thread.backgroundLiveness != null ||
    input.queuedTurnCount > 0
  ) {
    return blocked("work-in-flight");
  }
  if (input.thread.hasPendingApprovals || input.thread.hasPendingUserInput) {
    return blocked("pending-request");
  }
  return { eligible: true };
}

export function buildBuiltInComposerCommands(input: {
  readonly forkEligibility: ThreadForkEligibility;
  readonly planModeUiEnabled?: boolean;
}): ReadonlyArray<BuiltInComposerCommand> {
  const commands: BuiltInComposerCommand[] = [
    {
      id: "model",
      command: "model",
      label: "/model",
      description: "Switch response model for this thread",
    },
  ];
  if (input.planModeUiEnabled !== false) {
    commands.push(
      {
        id: "plan",
        command: "plan",
        label: "/plan",
        description: "Switch this thread into plan mode",
      },
      {
        id: "default",
        command: "default",
        label: "/default",
        description: "Switch this thread back to normal build mode",
      },
    );
  }
  if (input.forkEligibility.eligible) {
    commands.push({
      id: "fork",
      command: "fork",
      label: "/fork",
      description: "Fork this thread at its current provider head",
    });
  }
  return commands;
}

export function parseStandaloneComposerSlashCommand(
  text: string,
): StandaloneComposerSlashCommand | null {
  const match = /^\/(plan|default|fork)$/i.exec(text.trim());
  const command = match?.[1]?.toLowerCase();
  return command === "plan" || command === "default" || command === "fork" ? command : null;
}

export function parseStandaloneComposerCommand(input: {
  readonly text: string;
  readonly attachmentCount: number;
  readonly contextCount: number;
}): StandaloneComposerSlashCommand | null {
  if (input.attachmentCount > 0 || input.contextCount > 0) return null;
  return parseStandaloneComposerSlashCommand(input.text);
}
