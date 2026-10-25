import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";
import type { HtmlCitationContext } from "./HtmlCitationActions";
import "~/index.css";

const threadRef = {
  environmentId: EnvironmentId.make("message-environment"),
  threadId: ThreadId.make("message-thread"),
};

it("creates the same v2 source structure for a regular assistant message", async () => {
  const onCite = vi.fn<HtmlCitationContext["onCite"]>(() => true);
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
        <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
      </div>
    );
  }
  await using screen = await render(<MessagePreview />);
  await act(async () => {
    const range = document.createRange();
    range.selectNodeContents(screen.container.querySelector("p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
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
});
