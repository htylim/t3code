import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ApprovalRequestId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCompactChatApprovalCommand,
  buildCompactChatInterruptCommand,
  buildCompactChatStartTurnCommand,
  buildCompactChatUserInputCommand,
  buildSideChatCreateCommand,
  compactChatAllowsMainShortcut,
  resolveNewSideChatShortcutAction,
  type CompactChatTargetThread,
} from "./CompactChatSurface.logic";

const owner = scopeThreadRef(EnvironmentId.make("env-owner"), ThreadId.make("thread-owner"));
const target = scopeThreadRef(EnvironmentId.make("env-target"), ThreadId.make("thread-target"));
const thread: CompactChatTargetThread = {
  title: "Target thread",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5",
  },
  runtimeMode: "auto",
  interactionMode: "default",
  session: {
    threadId: target.threadId,
    status: "running",
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: "auto",
    activeTurnId: TurnId.make("turn-target"),
    lastError: null,
    updatedAt: "2026-08-11T12:00:00.000Z",
  },
};

describe("compact Chat target isolation", () => {
  it("creates a blank side chat with the main chat's working settings", () => {
    const modelSelection = {
      instanceId: ProviderInstanceId.make("codex-work"),
      model: "gpt-5.6",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const create = buildSideChatCreateCommand({
      target,
      sourceThread: {
        projectId: ProjectId.make("project-main"),
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "plan",
        branch: "feature/current",
        worktreePath: "/repo/current-worktree",
      },
      createdAt: "2026-08-12T12:00:00.000Z",
    });

    expect(create).toEqual({
      environmentId: target.environmentId,
      input: {
        threadId: target.threadId,
        projectId: ProjectId.make("project-main"),
        title: "New thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "plan",
        branch: "feature/current",
        worktreePath: "/repo/current-worktree",
        createdAt: "2026-08-12T12:00:00.000Z",
      },
    });
  });

  it("builds every mutation from the explicit target instead of the owner", () => {
    const start = buildCompactChatStartTurnCommand({
      owner,
      target,
      thread,
      text: "Continue",
      messageId: MessageId.make("message-target"),
      createdAt: "2026-08-11T12:01:00.000Z",
    });
    const interrupt = buildCompactChatInterruptCommand({ target, session: thread.session });
    const approval = buildCompactChatApprovalCommand({
      target,
      requestId: ApprovalRequestId.make("approval-target"),
      decision: "accept",
    });
    const userInput = buildCompactChatUserInputCommand({
      target,
      requestId: ApprovalRequestId.make("input-target"),
      answers: { choice: "Yes" },
    });

    for (const command of [start, interrupt, approval, userInput]) {
      expect(command.environmentId).toBe(target.environmentId);
      expect(command.input.threadId).toBe(target.threadId);
      expect(command.environmentId).not.toBe(owner.environmentId);
      expect(command.input.threadId).not.toBe(owner.threadId);
    }
    expect(interrupt.input.turnId).toBe(TurnId.make("turn-target"));
  });

  it("sends composer-selected attachments, model, and modes to the target", () => {
    const modelSelection = {
      instanceId: ProviderInstanceId.make("codex-work"),
      model: "gpt-5.6",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const attachments = [
      {
        type: "image" as const,
        name: "reference.png",
        mimeType: "image/png",
        sizeBytes: 42,
        dataUrl: "data:image/png;base64,YQ==",
      },
    ];

    const start = buildCompactChatStartTurnCommand({
      owner,
      target,
      thread,
      text: "Use this image",
      attachments,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "plan",
      messageId: MessageId.make("message-with-image"),
      createdAt: "2026-08-15T12:01:00.000Z",
    });

    expect(start.environmentId).toBe(target.environmentId);
    expect(start.input.threadId).toBe(target.threadId);
    expect(start.input.message.attachments).toEqual(attachments);
    expect(start.input.modelSelection).toEqual(modelSelection);
    expect(start.input.runtimeMode).toBe("full-access");
    expect(start.input.interactionMode).toBe("plan");
  });

  it("adds the owning main thread as provider-only context in the same environment", () => {
    const sameEnvironmentOwner = scopeThreadRef(target.environmentId, ThreadId.make("thread-main"));

    const start = buildCompactChatStartTurnCommand({
      owner: sameEnvironmentOwner,
      target,
      thread,
      text: "What did we decide?",
      messageId: MessageId.make("message-with-side-context"),
      createdAt: "2026-08-15T12:02:00.000Z",
    });

    expect(start.input.message.text).toBe("What did we decide?");
    expect(start.input.sideChatContext).toEqual({
      mainThreadId: sameEnvironmentOwner.threadId,
    });
  });

  it("does not claim access to an owner in another environment", () => {
    const start = buildCompactChatStartTurnCommand({
      owner,
      target,
      thread,
      text: "Continue",
      messageId: MessageId.make("message-cross-environment"),
      createdAt: "2026-08-15T12:03:00.000Z",
    });

    expect(start.input).not.toHaveProperty("sideChatContext");
  });
});

describe("compact Chat availability", () => {
  it("allows panel and new-side-chat shortcuts through the main Chat handler", () => {
    expect(compactChatAllowsMainShortcut("chat.newSide")).toBe(true);
    expect(compactChatAllowsMainShortcut("rightPanel.close")).toBe(true);
    expect(compactChatAllowsMainShortcut("rightPanel.toggle")).toBe(true);
    expect(compactChatAllowsMainShortcut("diff.toggle")).toBe(false);
    expect(compactChatAllowsMainShortcut("terminal.toggle")).toBe(false);
    expect(compactChatAllowsMainShortcut("modelPicker.toggle")).toBe(false);
  });

  it("closes only a visible active side chat", () => {
    expect(
      resolveNewSideChatShortcutAction({ rightPanelOpen: true, activeSurfaceKind: "chat" }),
    ).toBe("close");
    expect(
      resolveNewSideChatShortcutAction({ rightPanelOpen: false, activeSurfaceKind: "chat" }),
    ).toBe("open");
    expect(
      resolveNewSideChatShortcutAction({ rightPanelOpen: true, activeSurfaceKind: "files" }),
    ).toBe("open");
  });
});
