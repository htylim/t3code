import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { requestThreadRename, subscribeThreadRename } from "./threadRenameBus";

describe("threadRenameBus", () => {
  it("delivers rename requests until the listener unsubscribes", () => {
    const listener = vi.fn();
    const threadRef = {
      environmentId: EnvironmentId.make("environment-local"),
      threadId: ThreadId.make("thread-1"),
    };
    const unsubscribe = subscribeThreadRename(listener);

    requestThreadRename(threadRef);
    expect(listener).toHaveBeenCalledWith(threadRef);

    unsubscribe();
    requestThreadRename(threadRef);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
