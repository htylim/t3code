import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { DraftId, useComposerDraftStore } from "./composerDraftStore";
import { useRightPanelStore } from "./rightPanelStore";
import {
  buildAskInNewThreadPrompt,
  buildAskInSideChatPrompt,
  createSelectedTextThreadDraft,
  reuseSelectedTextSideChatDraft,
} from "./selectedTextThreadAction";

describe("Ask in new thread prompt", () => {
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

describe("reuse selected-text side chat draft", () => {
  const owner = {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("owner"),
  };
  const target = { ...owner, threadId: ThreadId.make("side-chat") };

  beforeEach(() => {
    useRightPanelStore.setState({ byThreadKey: {} });
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
  });

  it.each(["", "My question", "My question ", "My question\n\n"])(
    "reuses the transient target and preserves existing draft text %j",
    (existingPrompt) => {
      const panels = useRightPanelStore.getState();
      const drafts = useComposerDraftStore.getState();
      panels.openChat(owner, target, { transient: true });
      drafts.setPrompt(owner, "Main draft");
      drafts.setPrompt(target, existingPrompt);
      const surfaces = useRightPanelStore.getState().byThreadKey[scopedThreadKey(owner)]!.surfaces;
      const citation: AssistantCitation = {
        version: 1,
        ...owner,
        messageId: MessageId.make("message-1"),
        text: "Selected answer",
        start: 0,
        end: 15,
        prefix: "",
        suffix: "",
      };
      const prompt = buildAskInSideChatPrompt(citation);

      expect(reuseSelectedTextSideChatDraft(owner, prompt)).toEqual(target);
      const updatedPrompt = drafts.getComposerDraft(target)!.prompt;
      expect(updatedPrompt).toBe(
        `${existingPrompt}${existingPrompt === "My question" ? " " : ""}${prompt}`,
      );
      expect(collectAssistantCitations(updatedPrompt).map((match) => match.citation)).toEqual([
        citation,
      ]);
      expect(drafts.getComposerDraft(owner)!.prompt).toBe("Main draft");
      expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(owner)]!.surfaces).toEqual(
        surfaces,
      );
    },
  );

  it("reveals the reused chat when another surface is active and the panel is hidden", () => {
    const panels = useRightPanelStore.getState();
    panels.openChat(owner, target, { transient: true });
    panels.open(owner, "files");
    panels.close(owner);

    expect(reuseSelectedTextSideChatDraft(owner, "Selection ")).toEqual(target);
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(owner)]).toMatchObject({
      isOpen: true,
      activeSurfaceId: `chat:${target.environmentId}:${target.threadId}`,
    });
  });

  it("does not reuse or modify a regular side chat", () => {
    useRightPanelStore.getState().openChat(owner, target);
    useComposerDraftStore.getState().setPrompt(target, "Regular draft");
    const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(owner)];

    expect(reuseSelectedTextSideChatDraft(owner, "Selection ")).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(target)!.prompt).toBe("Regular draft");
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(owner)]).toBe(panel);
  });

  it("does not reuse a transient chat belonging to another environment or owner", () => {
    useRightPanelStore.getState().openChat(owner, target, { transient: true });

    expect(
      reuseSelectedTextSideChatDraft(
        { ...owner, environmentId: EnvironmentId.make("environment-2") },
        "Selection ",
      ),
    ).toBeNull();
    expect(
      reuseSelectedTextSideChatDraft({ ...owner, threadId: ThreadId.make("other-owner") }, "Text"),
    ).toBeNull();
    expect(useComposerDraftStore.getState().getComposerDraft(target)).toBeNull();
  });

  it("falls back to creation when there is no side chat", () => {
    expect(reuseSelectedTextSideChatDraft(owner, "Selection ")).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadKey).toEqual({});
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
