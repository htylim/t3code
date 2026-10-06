import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { usePostponedThreadStore } from "../postponedThreadStore";
import { makeThreadFixture } from "../test-fixtures";
import { useMovePostponedThreadToActive } from "./useMovePostponedThreadToActive";

const commands = vi.hoisted(() => ({ unsettleThread: vi.fn(), unsnoozeThread: vi.fn() }));
const shellReader = vi.hoisted(() => vi.fn());
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("../state/threads", () => ({
  threadEnvironment: { unsettle: "unsettle", unsnooze: "unsnooze" },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "unsettle" ? commands.unsettleThread : commands.unsnoozeThread,
}));
vi.mock("../state/entities", () => ({ readThreadShell: shellReader }));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
  stackedThreadToast: (notice: unknown) => notice,
}));

const thread = makeThreadFixture();
const threadRef = scopeThreadRef(thread.environmentId, thread.id);
const threadKey = scopedThreadKey(threadRef);

beforeEach(() => {
  vi.clearAllMocks();
  commands.unsettleThread.mockResolvedValue(AsyncResult.success(undefined));
  commands.unsnoozeThread.mockResolvedValue(AsyncResult.success(undefined));
  shellReader.mockReturnValue(thread);
  usePostponedThreadStore.setState({ byThreadKey: {} });
  usePostponedThreadStore.getState().postpone([thread]);
});

describe("move postponed work to active", () => {
  it("restores ordinary work without sending an unrelated server command", async () => {
    expect(await useMovePostponedThreadToActive()(threadRef)).toBe(true);
    expect(usePostponedThreadStore.getState().byThreadKey[threadKey]).toBeUndefined();
    expect(commands.unsettleThread).not.toHaveBeenCalled();
    expect(commands.unsnoozeThread).not.toHaveBeenCalled();
  });

  it("clears automatic settlement and any snooze before removing postponement", async () => {
    shellReader.mockReturnValue({
      ...thread,
      settledOverride: "settled",
      snoozedUntil: "2026-10-10T10:00:00Z",
    });
    commands.unsettleThread.mockImplementation(async () => {
      expect(usePostponedThreadStore.getState().byThreadKey[threadKey]).toBeDefined();
      return AsyncResult.success(undefined);
    });
    expect(await useMovePostponedThreadToActive()(threadRef)).toBe(true);
    const commandInput = {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, reason: "user" },
    };
    expect(commands.unsnoozeThread).toHaveBeenCalledExactlyOnceWith(commandInput);
    expect(commands.unsettleThread).toHaveBeenCalledExactlyOnceWith(commandInput);
    expect(usePostponedThreadStore.getState().byThreadKey[threadKey]).toBeUndefined();
  });

  it("keeps work postponed if the server cannot restore it", async () => {
    shellReader.mockReturnValue({ ...thread, settledOverride: "settled" });
    commands.unsettleThread.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("Disconnected"))),
    );
    expect(await useMovePostponedThreadToActive()(threadRef)).toBe(false);
    expect(usePostponedThreadStore.getState().byThreadKey[threadKey]).toBeDefined();
    expect(toastManager.add).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Disconnected" }),
    );
  });

  it("preserves disconnected environment preferences when no thread shell is available", async () => {
    shellReader.mockReturnValue(null);
    expect(await useMovePostponedThreadToActive()(threadRef)).toBe(false);
    expect(usePostponedThreadStore.getState().byThreadKey[threadKey]).toBeDefined();
  });
});
