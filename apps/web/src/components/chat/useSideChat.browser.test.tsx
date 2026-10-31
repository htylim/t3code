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
import { useChatShortcuts } from "./useChatShortcuts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";

const server = vi.hoisted(() => ({
  fork: vi.fn(),
  delete: vi.fn(),
  send: vi.fn(),
  readThreadShell: vi.fn(),
}));

vi.mock("../../state/threads", () => ({
  threadEnvironment: { forkSideChat: "fork", delete: "delete", startTurn: "send" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: "fork" | "delete") => server[command],
}));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => server.send,
}));
vi.mock("../../state/entities", () => ({
  waitForThreadShell: async () => true,
  readThreadShell: server.readThreadShell,
}));

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
  useChatShortcuts({
    enabled: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      rightPanelOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    threadFindActive: false,
    composerRef: { current: null },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {
      "chat.newSide": ({ event }) => {
        if (!event.repeat) void sideChat.open();
      },
    },
    fallback: () => undefined,
  });
  return (
    <>
      <button
        onClick={() =>
          void sideChat.open(undefined, { draftPrompt: buildAskInSideChatPrompt(citation) })
        }
      >
        Ask in side chat
      </button>
      <button onClick={() => void sideChat.open("Explain the main thread's approach")}>
        Ask immediately
      </button>
    </>
  );
}

/** Resets the external server boundary and real client stores for each mount. */
function setup() {
  server.fork.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  server.delete.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  server.send.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  server.readThreadShell.mockReset();
  useRightPanelStore.setState({ byThreadKey: {} });
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
}

it.each([
  { runtimeMode: "full-access", composerMode: null, expectedMode: "full-access" },
  { runtimeMode: "approval-required", composerMode: null, expectedMode: "approval-required" },
  { runtimeMode: "approval-required", composerMode: "full-access", expectedMode: "full-access" },
  {
    runtimeMode: "full-access",
    composerMode: "approval-required",
    expectedMode: "approval-required",
  },
] as const)(
  "keeps quotes unsent and inherits $expectedMode from $runtimeMode with composer $composerMode",
  async ({ runtimeMode, composerMode, expectedMode }) => {
    setup();
    server.readThreadShell.mockReturnValue({ runtimeMode });
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    useComposerDraftStore.getState().setPrompt(parentRef, "Unsent main-thread work");
    if (composerMode !== null) {
      useComposerDraftStore.getState().setRuntimeMode(parentRef, composerMode);
    }
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
    if (composerMode !== null) expect(draft.runtimeMode).toBe(composerMode);
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

    await userEvent.keyboard("{Meta>}t{/Meta}");
    await vi.waitFor(() => {
      expect(
        useRightPanelStore.getState().byThreadKey[scopedThreadKey(parentRef)]?.surfaces,
      ).toHaveLength(3);
    });
    expect(server.send).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(parentRef)?.prompt).toBe(
      "Unsent main-thread work",
    );
    await userEvent.click(screen.getByRole("button", { name: "Ask immediately" }));
    await vi.waitFor(() => {
      expect(
        useRightPanelStore.getState().byThreadKey[scopedThreadKey(parentRef)]?.surfaces,
      ).toHaveLength(4);
    });
    expect(server.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ runtimeMode: expectedMode }) }),
    );
  },
);
