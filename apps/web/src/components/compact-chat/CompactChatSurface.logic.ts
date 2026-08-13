import type {
  ApprovalRequestId,
  KeybindingCommand,
  MessageId,
  ModelSelection,
  OrchestrationSession,
  ProjectId,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  ScopedThreadRef,
  TurnId,
} from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

import type { ComposerCommandItem } from "~/components/chat/ComposerCommandMenu";
import { serializeThreadReferenceMarkdown } from "~/threadReference";

export interface CompactChatTargetThread {
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly session: OrchestrationSession | null;
}

export interface SideChatSourceThread {
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
}

export function compactChatComposerItemReplacement(item: ComposerCommandItem): string | null {
  if (item.type === "path") {
    return `${serializeComposerFileLink(item.path)} `;
  }
  if (item.type === "thread") {
    return `${serializeThreadReferenceMarkdown(item.label, item.threadRef)} `;
  }
  if (item.type === "skill") {
    return `$${item.skill.name} `;
  }
  return null;
}

export function buildSideChatCreateCommand(input: {
  readonly target: ScopedThreadRef;
  readonly sourceThread: SideChatSourceThread;
  readonly createdAt: string;
}) {
  return {
    environmentId: input.target.environmentId,
    input: {
      threadId: input.target.threadId,
      projectId: input.sourceThread.projectId,
      title: "New thread",
      modelSelection: input.sourceThread.modelSelection,
      runtimeMode: input.sourceThread.runtimeMode,
      interactionMode: input.sourceThread.interactionMode,
      branch: input.sourceThread.branch,
      worktreePath: input.sourceThread.worktreePath,
      createdAt: input.createdAt,
    },
  };
}

export function compactChatCanSend(input: {
  readonly connected: boolean;
  readonly providerAvailable: boolean;
  readonly threadAvailable: boolean;
  readonly session: OrchestrationSession | null;
  readonly hasPendingRequest: boolean;
  readonly sending: boolean;
}): boolean {
  return (
    input.connected &&
    input.providerAvailable &&
    input.threadAvailable &&
    !input.sending &&
    !input.hasPendingRequest &&
    input.session?.status !== "starting" &&
    input.session?.status !== "running"
  );
}

export function buildCompactChatStartTurnCommand(input: {
  readonly target: ScopedThreadRef;
  readonly thread: CompactChatTargetThread;
  readonly text: string;
  readonly messageId: MessageId;
  readonly createdAt: string;
}) {
  return {
    environmentId: input.target.environmentId,
    input: {
      threadId: input.target.threadId,
      message: {
        messageId: input.messageId,
        role: "user" as const,
        text: input.text,
        attachments: [],
      },
      modelSelection: input.thread.modelSelection,
      titleSeed: input.thread.title,
      runtimeMode: input.thread.runtimeMode,
      interactionMode: input.thread.interactionMode,
      createdAt: input.createdAt,
    },
  };
}

export function buildCompactChatInterruptCommand(input: {
  readonly target: ScopedThreadRef;
  readonly session: OrchestrationSession | null;
}) {
  const turnId: TurnId | null =
    input.session?.status === "running" ? input.session.activeTurnId : null;
  return {
    environmentId: input.target.environmentId,
    input: {
      threadId: input.target.threadId,
      ...(turnId !== null ? { turnId } : {}),
    },
  };
}

export function buildCompactChatApprovalCommand(input: {
  readonly target: ScopedThreadRef;
  readonly requestId: ApprovalRequestId;
  readonly decision: ProviderApprovalDecision;
}) {
  return {
    environmentId: input.target.environmentId,
    input: {
      threadId: input.target.threadId,
      requestId: input.requestId,
      decision: input.decision,
    },
  };
}

export function buildCompactChatUserInputCommand(input: {
  readonly target: ScopedThreadRef;
  readonly requestId: ApprovalRequestId;
  readonly answers: ProviderUserInputAnswers;
}) {
  return {
    environmentId: input.target.environmentId,
    input: {
      threadId: input.target.threadId,
      requestId: input.requestId,
      answers: input.answers,
    },
  };
}

export function compactChatAllowsMainShortcut(command: KeybindingCommand): boolean {
  return (
    command === "chat.newSide" || command === "rightPanel.close" || command === "rightPanel.toggle"
  );
}
