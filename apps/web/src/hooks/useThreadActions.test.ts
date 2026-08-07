import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ThreadArchiveBlockedError,
  ThreadForkBlockedError,
  ThreadForkUnsupportedError,
} from "./useThreadActions";

describe("ThreadArchiveBlockedError", () => {
  it("keeps the blocked thread context with the fixed message", () => {
    const error = new ThreadArchiveBlockedError({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });

    expect(error).toMatchObject({
      environmentId: "environment-1",
      threadId: "thread-1",
    });
    expect(error.message).toBe("Cannot archive a running thread.");
  });
});

describe("thread fork errors", () => {
  it("web rejects /fork while the source has work in flight", () => {
    expect(
      new ThreadForkBlockedError({
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
      }).message,
    ).toBe("Wait for the current thread work to finish before forking it.");
  });

  it("web reports unsupported manual /fork attempts clearly", () => {
    expect(
      new ThreadForkUnsupportedError({
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
      }).message,
    ).toContain("does not support thread forking");
  });
});
