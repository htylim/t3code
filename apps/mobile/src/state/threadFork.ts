import type { ThreadId } from "@t3tools/contracts";
import {
  parseStandaloneComposerCommand,
  type ThreadForkEligibility,
} from "@t3tools/shared/composerCommands";

type ForkDispatchResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export async function executeMobileThreadFork(input: {
  readonly text: string;
  readonly attachmentCount: number;
  readonly contextCount: number;
  readonly eligibility: ThreadForkEligibility;
  readonly targetThreadId: ThreadId;
  readonly dispatchFork: (targetThreadId: ThreadId) => Promise<ForkDispatchResult>;
  readonly enqueue: () => Promise<unknown>;
  readonly clearDraft: () => void;
  readonly replaceRoute: (targetThreadId: ThreadId) => void;
  readonly showError: (message: string) => void;
}): Promise<
  | { readonly handled: false; readonly queued: unknown }
  | { readonly handled: true; readonly succeeded: boolean; readonly targetThreadId: ThreadId }
> {
  if (
    parseStandaloneComposerCommand({
      text: input.text,
      attachmentCount: input.attachmentCount,
      contextCount: input.contextCount,
    }) !== "fork"
  ) {
    return { handled: false, queued: await input.enqueue() };
  }

  if (!input.eligibility.eligible) {
    input.showError(input.eligibility.message);
    return { handled: true, succeeded: false, targetThreadId: input.targetThreadId };
  }

  const result = await input.dispatchFork(input.targetThreadId);
  if (!result.ok) {
    input.showError(result.message);
    return { handled: true, succeeded: false, targetThreadId: input.targetThreadId };
  }

  input.clearDraft();
  input.replaceRoute(input.targetThreadId);
  return { handled: true, succeeded: true, targetThreadId: input.targetThreadId };
}
