import { describe, expect, it, vi } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";

import { executeMobileThreadFork } from "./threadFork";

const eligible = { eligible: true as const };

function input(overrides: Record<string, unknown> = {}) {
  return {
    text: "/fork",
    attachmentCount: 0,
    contextCount: 0,
    eligibility: eligible,
    targetThreadId: ThreadId.make("target"),
    dispatchFork: vi.fn(async () => ({ ok: true as const })),
    enqueue: vi.fn(async () => "queued"),
    clearDraft: vi.fn(),
    replaceRoute: vi.fn(),
    showError: vi.fn(),
    ...overrides,
  };
}

describe("mobile thread fork", () => {
  it("mobile exact /fork bypasses the outbox", async () => {
    const options = input();
    await executeMobileThreadFork(options);
    expect(options.dispatchFork).toHaveBeenCalledOnce();
    expect(options.enqueue).not.toHaveBeenCalled();
  });

  it("mobile /fork with text follows the ordinary outbox path", async () => {
    const options = input({ text: "/fork explain" });
    await executeMobileThreadFork(options);
    expect(options.enqueue).toHaveBeenCalledOnce();
    expect(options.dispatchFork).not.toHaveBeenCalled();
  });

  it("mobile rejects unsupported sources and sources with work in flight with a clear alert", async () => {
    for (const forkEligibility of [
      { eligible: false as const, reason: "unsupported-provider" as const, message: "Unsupported" },
      { eligible: false as const, reason: "work-in-flight" as const, message: "Busy" },
    ]) {
      const options = input({ eligibility: forkEligibility });
      await executeMobileThreadFork(options);
      expect(options.showError).toHaveBeenCalledWith(forkEligibility.message);
      expect(options.enqueue).not.toHaveBeenCalled();
    }
  });

  it("mobile replaces the source route with the canonical target on success", async () => {
    const options = input();
    await executeMobileThreadFork(options);
    expect(options.replaceRoute).toHaveBeenCalledWith(ThreadId.make("target"));
  });

  it("mobile preserves the draft and target id on dispatch failure", async () => {
    const targetThreadId = ThreadId.make("target");
    const options = input({
      targetThreadId,
      dispatchFork: vi.fn(async () => ({ ok: false as const, message: "Native fork failed" })),
    });
    const result = await executeMobileThreadFork(options);
    expect(result).toEqual({ handled: true, succeeded: false, targetThreadId });
    expect(options.clearDraft).not.toHaveBeenCalled();
  });
});
