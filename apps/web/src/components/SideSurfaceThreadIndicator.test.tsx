// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { SideSurfaceThreadIndicators } from "./SideSurfaceThreadIndicator";
import { TooltipProvider } from "./ui/tooltip";

const ownerThreadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("owner"));
const sideThreadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("side"));
const otherOwnerThreadRef = scopeThreadRef(EnvironmentId.make("env-2"), ThreadId.make("owner"));

let root: Root;
let container: HTMLDivElement;
const navigateToThread = vi.fn();
const activateRow = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  navigateToThread.mockReset();
  activateRow.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Render inside a clickable row to exercise navigation and event propagation together. */
async function renderIndicators(threadRef: ScopedThreadRef = sideThreadRef, hasSideChat = false) {
  await act(async () => {
    root.render(
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

/** Find the actual navigation button, failing if the indicator is no longer interactive. */
function parentThreadButton() {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="In a side chat"]');
  if (!button) throw new Error("Parent-thread navigation button was not rendered");
  return button;
}

/** Read the owner's saved panel after the indicator activates it. */
function ownerPanel(threadRef: ScopedThreadRef = ownerThreadRef) {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
}

describe("side-chat parent navigation", () => {
  it("opens the parent and reveals its saved chat when another tab was selected and hidden", async () => {
    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    const savedSurfaces = ownerPanel().surfaces;
    panelStore.open(ownerThreadRef, "files");
    panelStore.close(ownerThreadRef);
    await renderIndicators();

    await act(async () => parentThreadButton().click());

    expect(navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
    expect(activateRow).not.toHaveBeenCalled();
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

    expect(navigateToThread).toHaveBeenCalledExactlyOnceWith(otherOwnerThreadRef);
    expect(ownerPanel().isOpen).toBe(false);
    expect(ownerPanel(otherOwnerThreadRef).isOpen).toBe(true);
  });

  it("keeps transient metadata and the thread's own side chat intact", async () => {
    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef, { transient: true });
    panelStore.openChat(sideThreadRef, otherOwnerThreadRef);
    const originalOwnerSurfaces = ownerPanel().surfaces;
    const originalSidePanel = ownerPanel(sideThreadRef);
    await renderIndicators(sideThreadRef, true);

    await act(async () => parentThreadButton().click());

    expect(navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
    expect(ownerPanel().surfaces).toBe(originalOwnerSurfaces);
    expect(ownerPanel().surfaces[0]).toMatchObject({ transient: true });
    expect(ownerPanel(sideThreadRef)).toBe(originalSidePanel);
  });

  it("opens the first saved parent when more than one thread hosts the same side chat", async () => {
    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    panelStore.openChat(otherOwnerThreadRef, sideThreadRef);
    await renderIndicators();

    await act(async () => parentThreadButton().click());

    expect(navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
  });

  it("does nothing if the relationship was removed before clicking", async () => {
    const panelStore = useRightPanelStore.getState();
    panelStore.openChat(ownerThreadRef, sideThreadRef);
    await renderIndicators();
    panelStore.closeAllSurfaces(ownerThreadRef);

    await act(async () => parentThreadButton().click());

    expect(navigateToThread).not.toHaveBeenCalled();
    expect(activateRow).not.toHaveBeenCalled();
    expect(ownerPanel().isOpen).toBe(false);
  });

  it.each(["Enter", " "])(
    "keeps %j activation on the icon from opening the row's thread",
    async (key) => {
      useRightPanelStore.getState().openChat(ownerThreadRef, sideThreadRef);
      await renderIndicators();

      await act(async () => {
        const button = parentThreadButton();
        button.focus();
        button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        // jsdom does not synthesize the native button click generated by keyboard activation.
        button.click();
      });

      expect(navigateToThread).toHaveBeenCalledExactlyOnceWith(ownerThreadRef);
      expect(activateRow).not.toHaveBeenCalled();
    },
  );

  it("keeps double clicking the icon from starting the enclosing row's rename action", async () => {
    useRightPanelStore.getState().openChat(ownerThreadRef, sideThreadRef);
    await renderIndicators();

    await act(async () => {
      parentThreadButton().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(activateRow).not.toHaveBeenCalled();
  });
});
