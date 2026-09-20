import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { threadForkConcurrencyKey } from "./threadCommands.ts";

describe("thread fork commands", () => {
  it("client-runtime serializes duplicate fork actions for the same source", () => {
    const environmentId = EnvironmentId.make("environment");
    const sourceThreadId = ThreadId.make("source");

    expect(threadForkConcurrencyKey({ environmentId, input: { sourceThreadId } })).toBe(
      threadForkConcurrencyKey({
        environmentId,
        input: { sourceThreadId, threadId: ThreadId.make("different-target") },
      }),
    );
  });
});
