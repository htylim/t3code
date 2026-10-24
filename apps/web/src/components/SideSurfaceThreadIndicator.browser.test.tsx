import { act, render as renderScreen } from "../../test/render";
import { userEvent } from "vite-plus/test/browser";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { SideSurfaceThreadIndicators } from "./SideSurfaceThreadIndicator";
import { TooltipProvider } from "./ui/tooltip";

const ownerThreadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("owner"));
const sideThreadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("side"));
const otherOwnerThreadRef = scopeThreadRef(EnvironmentId.make("env-2"), ThreadId.make("owner"));

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  const navigateToThread = vi.fn();
  const activateRow = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const screen = await renderScreen(null, { container });

  async function renderIndicators(threadRef: ScopedThreadRef = sideThreadRef, hasSideChat = false) {
    await act(async () => {
      screen.rerender(
        <TooltipProvider>
          <div onClick={activateRow} onKeyDown={activateRow} onDoubleClick={activateRow}>
            <SideSurfaceThreadIndicators
              hasSideChat={hasSideChat}
              isSideChat
              threadRef={threadRef}
              onNavigateToThread={navigateToThread}
            />
          </div>
        </TooltipProvider>,
      );
    });
  }

  function parentThreadButton() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="In a side chat"]',
    );
    if (!button) throw new Error("Parent-thread navigation button was not rendered");
    return button;
  }
  return {
    screen,
    container,
    renderIndicators,
    navigateToThread,
    activateRow,
    parentThreadButton,
    async [Symbol.asyncDispose]() {
      try {
        vi.unstubAllGlobals();
      } finally {
        await screen[Symbol.asyncDispose]();
      }
    },
  };
}

/** Read the owner's saved panel after the indicator activates it. */
function ownerPanel(threadRef: ScopedThreadRef = ownerThreadRef) {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
}

describe("side-chat parent navigation", () => {
  it("opens the parent and reveals its saved chat when another tab was selected and hidden", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    const savedSurfaces = ownerPanel().surfaces;
    panelStore.open(ownerThreadRef, "files");
    panelStore.close(ownerThreadRef);
    await renderIndicators();

    await act(async () => parentThreadButton().click());

    expect(surface.navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
    expect(surface.activateRow).not.toHaveBeenCalled();
    expect(ownerPanel()).toMatchObject({
      isOpen: true,
      activeSurfaceId: savedSurfaces[0]?.id,
    });
    expect(ownerPanel().surfaces).toHaveLength(2);
    expect(ownerPanel().surfaces[0]).toBe(savedSurfaces[0]);
    expect(
      useRightPanelStore.getState().byThreadKey[scopedThreadKey(sideThreadRef)],
    ).toBeUndefined();
  });

  it("matches both environment and thread ids when finding a cross-environment parent", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    const panelStore = useRightPanelStore.getState();
    const otherSideThreadRef = scopeThreadRef(
      otherOwnerThreadRef.environmentId,
      sideThreadRef.threadId,
    );
    panelStore.openChat(ownerThreadRef, otherSideThreadRef);
    panelStore.openChat(otherOwnerThreadRef, sideThreadRef);
    panelStore.close(ownerThreadRef);
    panelStore.close(otherOwnerThreadRef);
    await renderIndicators();

    await act(async () => parentThreadButton().click());

    expect(surface.navigateToThread).toHaveBeenCalledExactlyOnceWith(otherOwnerThreadRef);
    expect(ownerPanel().isOpen).toBe(false);
    expect(ownerPanel(otherOwnerThreadRef).isOpen).toBe(true);
  });

  it("keeps transient metadata and the thread's own side chat intact", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef, { transient: true });
    panelStore.openChat(sideThreadRef, otherOwnerThreadRef);
    const originalOwnerSurfaces = ownerPanel().surfaces;
    const originalSidePanel = ownerPanel(sideThreadRef);
    await renderIndicators(sideThreadRef, true);

    await act(async () => parentThreadButton().click());

    expect(surface.navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
    expect(ownerPanel().surfaces).toBe(originalOwnerSurfaces);
    expect(ownerPanel().surfaces[0]).toMatchObject({ transient: true });
    expect(ownerPanel(sideThreadRef)).toBe(originalSidePanel);
  });

  it("opens the first saved parent when more than one thread hosts the same side chat", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    panelStore.openChat(otherOwnerThreadRef, sideThreadRef);
    await renderIndicators();

    await act(async () => parentThreadButton().click());

    expect(surface.navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
  });

  it("does nothing if the relationship was removed before clicking", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    await renderIndicators();
    panelStore.closeAllSurfaces(ownerThreadRef);

    await act(async () => parentThreadButton().click());

    expect(surface.navigateToThread).not.toHaveBeenCalled();
    expect(surface.activateRow).not.toHaveBeenCalled();
    expect(ownerPanel().isOpen).toBe(false);
  });

  it.each(["Enter", " "])(
    "keeps %j activation on the icon from opening the row's thread",
    async (key) => {
      await using surface = await createTestSurface();
      const { renderIndicators, parentThreadButton } = surface;

      useRightPanelStore.getState().openChat(ownerThreadRef, sideThreadRef);
      await renderIndicators();

      await (async () => {
        const button = parentThreadButton();
        button.focus();
        await userEvent.keyboard(key === "Enter" ? "{Enter}" : " ");
      })();

      expect(surface.navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
      expect(surface.activateRow).not.toHaveBeenCalled();
    },
  );

  it("keeps double clicking the icon from starting the enclosing row's rename action", async () => {
    await using surface = await createTestSurface();
    const { renderIndicators, parentThreadButton } = surface;

    useRightPanelStore.getState().openChat(ownerThreadRef, sideThreadRef);
    await renderIndicators();

    await act(async () => {
      parentThreadButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(surface.activateRow).not.toHaveBeenCalled();
  });
});
