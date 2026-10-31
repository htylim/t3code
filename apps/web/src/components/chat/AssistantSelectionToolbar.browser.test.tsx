import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import type { HtmlCitationContext } from "./HtmlCitationActions";
import "~/index.css";
import type { SelectedTextThreadActionHandler } from "~/selectedTextThreadAction";

const threadRef = {
  environmentId: EnvironmentId.make("message-environment"),
  threadId: ThreadId.make("message-thread"),
};

it("creates the same v2 source structure for a regular assistant message", async () => {
  const onCite = vi.fn<HtmlCitationContext["onCite"]>(() => true);
  const onAskAboutSelection = vi.fn<SelectedTextThreadActionHandler>().mockResolvedValue(undefined);
  /** Supplies the message identity that the actual timeline puts on rendered replies. */
  function MessagePreview() {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    return (
      <div ref={setViewport} style={{ width: 600 }}>
        <p
          data-assistant-citation-source="assistant-message"
          data-assistant-citation-environment={threadRef.environmentId}
          data-assistant-citation-thread={threadRef.threadId}
        >
          Use a native table.
        </p>
        <AssistantSelectionToolbar
          viewport={viewport}
          threadRef={threadRef}
          onCite={onCite}
          onAskAboutSelection={onAskAboutSelection}
        />
      </div>
    );
  }
  await using screen = await render(<MessagePreview />);
  /** Begin a fresh selection gesture after the previous toolbar was dismissed. */
  const selectMessage = async () => {
    await userEvent.click(screen.getByText("Use a native table."));
    await act(async () => {
      const range = document.createRange();
      range.selectNodeContents(screen.container.querySelector("p")!);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
  };
  await selectMessage();
  const cite = page.getByRole("button", { name: "Cite selection in composer" });
  await expect.element(cite).toBeVisible();
  await userEvent.click(cite);
  expect(onCite.mock.calls[0]?.[0]).toMatchObject({
    version: 2,
    text: "Use a native table.",
    source: {
      kind: "assistant-message",
      ...threadRef,
      messageId: MessageId.make("assistant-message"),
    },
  });

  await selectMessage();
  await userEvent.click(page.getByRole("button", { name: "Ask in side chat" }));
  expect(onAskAboutSelection).not.toHaveBeenCalled();
  const comment = page.getByRole("textbox", { name: "Comment on selected text" });
  await expect.element(comment).toHaveFocus();
  await userEvent.fill(comment, "Why is this preferable?");
  await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
  expect(onAskAboutSelection).toHaveBeenCalledWith(
    "ask-in-side-chat",
    { ...onCite.mock.calls[0]![0], comment: "Why is this preferable?" },
    "Use a native table.",
  );

  await selectMessage();
  await userEvent.click(page.getByRole("button", { name: "Ask in side chat" }));
  await userEvent.fill(comment, "Discard this comment");
  await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
  await expect.element(comment).not.toBeInTheDocument();
  expect(onAskAboutSelection).toHaveBeenCalledTimes(1);

  await selectMessage();
  await userEvent.click(page.getByRole("button", { name: "Ask in side chat" }));
  await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
  expect(onAskAboutSelection).toHaveBeenLastCalledWith(
    "ask-in-side-chat",
    onCite.mock.calls[0]![0],
    "Use a native table.",
  );
  expect(onAskAboutSelection).toHaveBeenCalledTimes(2);
});
