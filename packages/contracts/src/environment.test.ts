import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { OrchestrationRpcSchemas } from "./orchestration.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeDispatchCommand = Schema.decodeUnknownSync(
  OrchestrationRpcSchemas.dispatchCommand.input,
);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("treats a missing pull-request capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.pullRequests).toBeUndefined();
  });

  it("preserves an advertised pull-request capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, pullRequests: true },
      }).capabilities.pullRequests,
    ).toBe(true);
  });

  it("treats an absent environment threadFork capability as unsupported", () => {
    expect(decodeDescriptor(descriptor).capabilities.threadFork ?? false).toBe(false);
  });
});

describe("thread fork command schema", () => {
  it("accepts thread.fork through the existing HTTP dispatch payload", () => {
    const operation = decodeDispatchCommand({
      type: "thread.fork",
      sourceThreadId: "thread-source",
      threadId: "thread-target",
      commandId: "cmd-http-fork",
      createdAt: "2026-08-06T00:00:00.000Z",
    });

    expect(operation.type).toBe("thread.fork");
  });
});
