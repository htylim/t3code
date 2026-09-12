import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { describe, expect, it, vi } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  buildAskInNewThreadPrompt,
  buildAskInSideChatPrompt,
  createSelectedTextThreadDraft,
} from "./selectedTextThreadAction";

describe("Ask in new thread prompt", () => {
  it("quotes selected Markdown and includes the canonical source thread reference", () => {
    expect(
      buildAskInNewThreadPrompt({
        selectedMarkdown: "First line\n\n- Second line",
        sourceThreadTitle: "Epic [3] finding",
        sourceThreadRef: {
          environmentId: EnvironmentId.make("local/environment"),
          threadId: ThreadId.make("thread/one"),
        },
      }),
    ).toBe(
      "Regarding this selection from [Epic \\[3\\] finding](t3code://threads/local%2Fenvironment/thread%2Fone):\n\n> First line\n>\n> - Second line\n\n",
    );
  });
});

describe("Ask in side chat prompt", () => {
  it("uses an assistant citation when the selection came from an assistant message", () => {
    const citation: AssistantCitation = {
      version: 1,
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("message-1"),
      text: "the selected answer",
      start: 4,
      end: 23,
      prefix: "See ",
      suffix: " here",
    };

    const prompt = buildAskInSideChatPrompt(citation);

    expect(collectAssistantCitations(prompt).map((match) => match.citation)).toEqual([citation]);
    expect(prompt).not.toContain("> the selected answer");
  });
});

describe("selected-text thread draft", () => {
  it("prefills the draft created by the new-thread action", async () => {
    const draftId = DraftId.make("draft-1");
    const calls: string[] = [];

    await createSelectedTextThreadDraft({
      prompt: "Quoted prompt",
      createThread: async () => {
        calls.push("create");
      },
      findCreatedDraft: () => {
        calls.push("find");
        return { draftId };
      },
      setPrompt: (target, prompt) => {
        calls.push(`set:${target}:${prompt}`);
      },
    });

    expect(calls).toEqual(["create", "find", "set:draft-1:Quoted prompt"]);
  });

  it("fails instead of overwriting an unrelated target when no draft was created", async () => {
    const setPrompt = vi.fn();

    await expect(
      createSelectedTextThreadDraft({
        prompt: "Quoted prompt",
        createThread: async () => {},
        findCreatedDraft: () => null,
        setPrompt,
      }),
    ).rejects.toThrow("The new thread draft could not be found.");
    expect(setPrompt).not.toHaveBeenCalled();
  });
});
