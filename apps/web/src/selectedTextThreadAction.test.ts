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
  it("keeps the exact HTML attachment and passage when moving a quote into a new thread", () => {
    const source = {
      kind: "html-attachment",
      environmentId: EnvironmentId.make("source-environment"),
      threadId: ThreadId.make("source-thread"),
      itemId: "second-preview",
      attachmentId: "second-html",
      title: "Chart choices",
    } as const;
    const citation: AssistantCitation = {
      version: 2,
      source,
      text: "Use a native table.",
      start: 0,
      end: 19,
      prefix: "",
      suffix: "",
    };
    const prompt = buildAskInNewThreadPrompt({
      sourceThreadRef: source,
      sourceThreadTitle: "Report",
      selectedMarkdown: citation.text,
      citation,
    });
    expect(collectAssistantCitations(prompt).map((match) => match.citation)).toEqual([citation]);
    expect(prompt).toContain("t3-context://v1/thread/thread_source-thread");
  });
  it("quotes selected Markdown and includes the canonical source thread reference", () => {
    expect(
      buildAskInNewThreadPrompt({
        selectedMarkdown: "First line\n\n- Second line",
        sourceThreadTitle: "Epic [3] finding",
        sourceThreadRef: {
          environmentId: EnvironmentId.make("local-environment"),
          threadId: ThreadId.make("thread-one"),
        },
      }),
    ).toBe(
      "Regarding this selection from [Epic 3 finding](t3-context://v1/thread/thread_thread-one):\n\n> First line\n>\n> - Second line\n\n",
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
    expect(prompt.endsWith(") ")).toBe(true);
  });
});

describe("selected-text thread draft", () => {
  it("prefills the returned draft when the project also has an older draft", async () => {
    const draftId = DraftId.make("draft-1");
    const calls: string[] = [];
    const olderDraftId = DraftId.make("older-draft");
    const prompts = new Map([[olderDraftId, "Existing work"]]);

    await createSelectedTextThreadDraft({
      prompt: "Quoted prompt",
      createThread: async () => {
        calls.push("create");
        return { draftId };
      },
      setPrompt: (target, prompt) => {
        calls.push(`set:${target}:${prompt}`);
        prompts.set(target, prompt);
      },
    });

    expect(calls).toEqual(["create", "set:draft-1:Quoted prompt"]);
    expect(prompts.get(draftId)).toBe("Quoted prompt");
    expect(prompts.get(olderDraftId)).toBe("Existing work");
  });

  it("fails instead of overwriting an unrelated target when no draft was created", async () => {
    const setPrompt = vi.fn();

    await expect(
      createSelectedTextThreadDraft({
        prompt: "Quoted prompt",
        createThread: async () => null,
        setPrompt,
      }),
    ).rejects.toThrow("The new thread draft could not be found.");
    expect(setPrompt).not.toHaveBeenCalled();
  });
});
