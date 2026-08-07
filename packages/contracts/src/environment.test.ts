import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { OrchestrationRpcSchemas } from "./orchestration.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

describe("execution environment thread fork capability", () => {
  it("treats an absent environment threadFork capability as unsupported", () => {
    const descriptor = decodeDescriptor({
      environmentId: "environment-1",
      label: "Local",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "1.0.0",
      capabilities: { repositoryIdentity: true },
    });

    expect(descriptor.capabilities.threadFork ?? false).toBe(false);
  });

  it("accepts thread.fork through the existing HTTP dispatch payload", () => {
    const operation = Schema.decodeUnknownSync(OrchestrationRpcSchemas.dispatchCommand.input)({
      type: "thread.fork",
      sourceThreadId: "thread-source",
      threadId: "thread-target",
      commandId: "cmd-http-fork",
      createdAt: "2026-08-06T00:00:00.000Z",
    });

    expect(operation.type).toBe("thread.fork");
  });
});
