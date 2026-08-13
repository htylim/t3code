import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ApprovalRequestId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
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
  compactChatCanSend,
  compactChatComposerItemReplacement,
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
  it("serializes side-chat file, skill, and thread picker choices", () => {
    expect(
      compactChatComposerItemReplacement({
        id: "path:file:src/index.ts",
        type: "path",
        path: "src/index.ts",
        pathKind: "file",
        label: "index.ts",
        description: "src",
      }),
    ).toBe("[index.ts](src/index.ts) ");
    expect(
      compactChatComposerItemReplacement({
        id: "skill:codex:review",
        type: "skill",
        provider: ProviderDriverKind.make("codex"),
        skill: {
          name: "review",
          path: "/skills/review/SKILL.md",
          enabled: true,
        },
        label: "Review",
        description: "Review code",
      }),
    ).toBe("$review ");
    expect(
      compactChatComposerItemReplacement({
        id: "thread:env-target:thread-owner",
        type: "thread",
        threadRef: owner,
        label: "Owner thread",
        description: "Project",
      }),
    ).toBe("[Owner thread](t3code://threads/env-owner/thread-owner) ");
  });

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
});

describe("compact Chat availability", () => {
  it("allows direct sends only while the target can accept a turn", () => {
    const base = {
      connected: true,
      providerAvailable: true,
      threadAvailable: true,
      session: null,
      hasPendingRequest: false,
      sending: false,
    };
    expect(compactChatCanSend(base)).toBe(true);
    expect(compactChatCanSend({ ...base, connected: false })).toBe(false);
    expect(compactChatCanSend({ ...base, providerAvailable: false })).toBe(false);
    expect(compactChatCanSend({ ...base, threadAvailable: false })).toBe(false);
    expect(compactChatCanSend({ ...base, hasPendingRequest: true })).toBe(false);
    expect(compactChatCanSend({ ...base, sending: true })).toBe(false);
    expect(compactChatCanSend({ ...base, session: thread.session })).toBe(false);
  });

  it("allows panel and new-side-chat shortcuts through the main Chat handler", () => {
    expect(compactChatAllowsMainShortcut("chat.newSide")).toBe(true);
    expect(compactChatAllowsMainShortcut("rightPanel.close")).toBe(true);
    expect(compactChatAllowsMainShortcut("rightPanel.toggle")).toBe(true);
    expect(compactChatAllowsMainShortcut("diff.toggle")).toBe(false);
    expect(compactChatAllowsMainShortcut("terminal.toggle")).toBe(false);
    expect(compactChatAllowsMainShortcut("modelPicker.toggle")).toBe(false);
  });
});
