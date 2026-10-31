import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { buildAskInSideChatPrompt } from "../../selectedTextThreadAction";
import { useSideChat } from "./useSideChat";

const server = vi.hoisted(() => ({ fork: vi.fn(), delete: vi.fn(), send: vi.fn() }));

vi.mock("../../state/threads", () => ({
  threadEnvironment: { forkSideChat: "fork", delete: "delete", startTurn: "send" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: "fork" | "delete") => server[command],
}));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => server.send,
}));
vi.mock("../../state/entities", () => ({ waitForThreadShell: async () => true }));

const parentRef = {
  environmentId: EnvironmentId.make("selection-environment"),
  threadId: ThreadId.make("selection-parent"),
};
const citation = {
  version: 1,
  ...parentRef,
  messageId: MessageId.make("selected-response"),
  text: "Selected passage",
  start: 0,
  end: 16,
  prefix: "",
  suffix: "",
} as const;

/** Drives the same native side-chat entry used by the selection toolbar. */
function SelectionSideChat() {
  const sideChat = useSideChat({ threadRef: parentRef, onError: () => undefined });
  return (
    <button
      onClick={() =>
        void sideChat.open(undefined, { draftPrompt: buildAskInSideChatPrompt(citation) })
      }
    >
      Ask in side chat
    </button>
  );
}

/** Resets the external server boundary and real client stores for each mount. */
function setup() {
  server.fork.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  server.delete.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  server.send.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  useRightPanelStore.setState({ byThreadKey: {} });
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
}

it("opens each selection as a native side-chat draft without sending or replacing another tab", async () => {
  setup();
  useComposerDraftStore.getState().setPrompt(parentRef, "Unsent main-thread work");
  await using screen = await render(<SelectionSideChat />);

  await userEvent.click(screen.getByRole("button", { name: "Ask in side chat" }));
  await vi.waitFor(() => {
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(parentRef)]?.surfaces,
    ).toHaveLength(1);
  });
  const firstPanel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(parentRef)]!;
  const firstSideChat = firstPanel.surfaces[0]!;
  expect(firstSideChat.kind).toBe("side-chat");
  if (firstSideChat.kind !== "side-chat") throw new Error("Expected a native side-chat tab.");
  const firstRef = { ...parentRef, threadId: firstSideChat.threadId };
  const draft = useComposerDraftStore.getState().getComposerDraft(firstRef)!;
  expect(collectAssistantCitations(draft.prompt).map((match) => match.citation)).toEqual([
    citation,
  ]);
  expect(useComposerDraftStore.getState().getComposerDraft(parentRef)?.prompt).toBe(
    "Unsent main-thread work",
  );
  expect(server.send).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Ask in side chat" }));
  await vi.waitFor(() => {
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(parentRef)]?.surfaces,
    ).toHaveLength(2);
  });
  expect(server.fork).toHaveBeenCalledTimes(2);
  expect(server.delete).not.toHaveBeenCalled();
  expect(server.send).not.toHaveBeenCalled();
  expect(useComposerDraftStore.getState().getComposerDraft(firstRef)?.prompt).toBe(draft.prompt);
});
