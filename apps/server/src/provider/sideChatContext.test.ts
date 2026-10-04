import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectSideChatContextForProvider } from "./sideChatContext.ts";

describe("side-chat provider context", () => {
  it("adds the owning thread and upstream read tool without changing the user's question", () => {
    const question = "What did we decide?\n\n> Quoted selection";
    const prompt = projectSideChatContextForProvider(question, {
      mainThreadId: ThreadId.make("main-thread"),
    });
    expect(prompt).toContain('owning main T3 thread ID is "main-thread"');
    expect(prompt).toContain("t3_thread_read");
    expect(prompt).toContain("afterPosition=nextPosition");
    expect(prompt.endsWith(`\n\n${question}`)).toBe(true);
  });

  it("leaves ordinary main-thread prompts unchanged", () => {
    expect(projectSideChatContextForProvider("Continue", undefined)).toBe("Continue");
  });
});
