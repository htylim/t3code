import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  SELECTED_TEXT_THREAD_CONTEXT_MENU_ITEMS,
  buildAskInNewThreadPrompt,
  createSelectedTextThreadDraft,
  showSelectedTextThreadContextMenu,
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

describe("selected-text context menu", () => {
  it("returns true only when Ask in new thread is chosen", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("ask-in-new-thread");

    await expect(
      showSelectedTextThreadContextMenu({
        position: { x: 12, y: 24 },
        showContextMenu,
      }),
    ).resolves.toBe(true);
    expect(showContextMenu).toHaveBeenCalledWith(SELECTED_TEXT_THREAD_CONTEXT_MENU_ITEMS, {
      x: 12,
      y: 24,
    });

    showContextMenu.mockResolvedValueOnce(null);
    await expect(
      showSelectedTextThreadContextMenu({
        position: { x: 1, y: 2 },
        showContextMenu,
      }),
    ).resolves.toBe(false);
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
