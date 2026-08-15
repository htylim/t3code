import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useRightPanelStore } from "./rightPanelStore";
import {
  SIDE_CHAT_REPLACEMENT_MESSAGE,
  confirmSideChatReplacement,
  openSideChat,
} from "./sideChatReplacement";
import { isTransientSideChat, useTransientSideChatStore } from "./transientSideChatStore";

const owner = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("owner"),
};
const target = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("target"),
};
const replacement = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId: ThreadId.make("replacement"),
};

describe("side chat replacement confirmation", () => {
  beforeEach(() => {
    useRightPanelStore.setState({ byThreadKey: {} });
    useTransientSideChatStore.setState({ byThreadKey: {} });
  });

  it("does not confirm when no side chat exists", async () => {
    const confirm = vi.fn().mockResolvedValue(false);

    await expect(confirmSideChatReplacement({ owner, confirm })).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not confirm when reopening the current target", async () => {
    useRightPanelStore.getState().openChat(owner, target);
    const confirm = vi.fn().mockResolvedValue(false);

    await expect(confirmSideChatReplacement({ owner, nextTarget: target, confirm })).resolves.toBe(
      true,
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("confirms before replacing the current target", async () => {
    useRightPanelStore.getState().openChat(owner, target);
    const confirm = vi.fn().mockResolvedValue(true);

    await expect(
      confirmSideChatReplacement({ owner, nextTarget: replacement, confirm }),
    ).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(SIDE_CHAT_REPLACEMENT_MESSAGE);
  });

  it("honors cancellation before blank side-chat creation", async () => {
    useRightPanelStore.getState().openChat(owner, target);
    const confirm = vi.fn().mockResolvedValue(false);

    await expect(confirmSideChatReplacement({ owner, confirm })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(SIDE_CHAT_REPLACEMENT_MESSAGE);
  });

  it("registers a transient target and returns it when replaced", () => {
    expect(openSideChat({ owner, target, transient: true })).toBeNull();
    expect(isTransientSideChat(target)).toBe(true);

    expect(openSideChat({ owner, target: replacement, transient: true })).toEqual(target);
    expect(isTransientSideChat(replacement)).toBe(true);
  });

  it("keeps existing-thread side surfaces persistent", () => {
    expect(openSideChat({ owner, target, transient: false })).toBeNull();
    expect(isTransientSideChat(target)).toBe(false);
    expect(
      useRightPanelStore.getState().byThreadKey[`${owner.environmentId}:${owner.threadId}`]
        ?.surfaces,
    ).toEqual([
      {
        id: `chat:${target.environmentId}:${target.threadId}`,
        kind: "chat",
        environmentId: target.environmentId,
        threadId: target.threadId,
      },
    ]);
  });

  it("promotes the current transient target instead of deleting it", () => {
    openSideChat({ owner, target, transient: true });

    expect(openSideChat({ owner, target, transient: false })).toBeNull();
    expect(isTransientSideChat(target)).toBe(false);
  });
});
