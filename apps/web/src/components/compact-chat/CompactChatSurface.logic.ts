import {
  isTimelinePromptKeybindingCommand,
  type ApprovalRequestId,
  type ChatAttachment,
  type KeybindingCommand,
  type MessageId,
  type ModelSelection,
  type OrchestrationSession,
  type ProjectId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderUserInputAnswers,
  type RuntimeMode,
  type ScopedThreadRef,
  type UploadChatAttachment,
  type TurnId,
} from "@t3tools/contracts";

import type { RightPanelKind } from "~/rightPanelStore";

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

export function buildCompactChatStartTurnCommand(input: {
  readonly owner: ScopedThreadRef;
  readonly target: ScopedThreadRef;
  readonly thread: CompactChatTargetThread;
  readonly text: string;
  readonly attachments?: ReadonlyArray<UploadChatAttachment | ChatAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
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
        attachments: input.attachments ?? [],
      },
      modelSelection: input.modelSelection ?? input.thread.modelSelection,
      titleSeed: input.thread.title,
      runtimeMode: input.runtimeMode ?? input.thread.runtimeMode,
      interactionMode: input.interactionMode ?? input.thread.interactionMode,
      ...(input.owner.environmentId === input.target.environmentId
        ? { sideChatContext: { mainThreadId: input.owner.threadId } }
        : {}),
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
    command === "chat.newSide" ||
    command === "rightPanel.close" ||
    command === "rightPanel.toggle" ||
    isTimelinePromptKeybindingCommand(command)
  );
}

export function resolveNewSideChatShortcutAction(input: {
  readonly rightPanelOpen: boolean;
  readonly activeSurfaceKind: RightPanelKind | null;
}): "open" | "close" {
  return input.rightPanelOpen && input.activeSurfaceKind === "chat" ? "close" : "open";
}
