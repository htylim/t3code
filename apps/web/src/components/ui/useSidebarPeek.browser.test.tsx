import { act, render as renderScreen, fakeTimers } from "../../../test/render";
import { useLayoutEffect, type PointerEvent as ReactPointerEvent } from "react";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { useSidebarPeek } from "./useSidebarPeek";

const contextMenu = vi.hoisted(() => ({ open: false }));
vi.mock("~/contextMenuFallback", () => ({ isContextMenuOpen: () => contextMenu.open }));
const documentEvents = document;
const windowEvents = window;

/** Sends mouse movement through the same document listener used by the client. */
async function movePointer(clientX: number, overrides: Partial<PointerEvent> = {}) {
  const event = Object.assign(new Event("pointermove"), {
    pointerType: "mouse",
    clientX,
    clientY: 300,
    buttons: 0,
    ...overrides,
  });
  await act(() => documentEvents.dispatchEvent(event));
  return event;
}

/** Advances intent delays without wall-clock waits. */
async function advance(milliseconds: number) {
  await act(() => vi.advanceTimersByTime(milliseconds));
}

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  let popupOpen = false;
  let peek: ReturnType<typeof useSidebarPeek>;
  contextMenu.open = false;
  /** Mounts the real hook on a sidebar-sized element to exercise pointer and timer behavior. */
  function SidebarFixture({ enabled = true }: { enabled?: boolean }) {
    const sidebarPeek = useSidebarPeek(enabled);
    const { panelRef } = sidebarPeek;
    useLayoutEffect(() => {
      peek = sidebarPeek;
    });
    return (
      <div
        ref={panelRef}
        data-sidebar-peek-fixture
        style={{ position: "fixed", left: 0, top: 0, width: 280, height: 900 }}
      />
    );
  }

  const container = document.createElement("div");
  await using cleanup = new AsyncDisposableStack();
  const screen = cleanup.use(await renderScreen(<SidebarFixture />, { container }));
  const panel = container.querySelector<HTMLDivElement>("[data-sidebar-peek-fixture]")!;
  cleanup
    .use(vi.spyOn(panel, "querySelector"))
    .mockImplementation(() => (popupOpen ? document.createElement("button") : null));

  /** Opens the preview through its edge gesture. */
  async function reveal() {
    await movePointer(2);
    await advance(300);
    expect(peek.peekOpen).toBe(true);
  }

  return {
    screen,
    panel,
    get peek() {
      return peek;
    },
    get popupOpen() {
      return popupOpen;
    },
    set popupOpen(open: boolean) {
      popupOpen = open;
    },
    /** Renders a fresh element when the sidebar mode changes. */
    renderSidebar: (enabled = true) => screen.rerender(<SidebarFixture enabled={enabled} />),
    reveal,
    cleanup: cleanup.move(),
    async [Symbol.asyncDispose]() {
      await this.cleanup.disposeAsync();
    },
  };
}

describe("collapsed sidebar hover preview", () => {
  it("requires deliberate edge hover and tolerates briefly leaving the panel", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await movePointer(2);
    await advance(299);
    expect(surface.peek.peekOpen).toBe(false);
    await movePointer(30);
    await advance(300);
    expect(surface.peek.peekOpen).toBe(false);
    await surface.reveal();
    await movePointer(400);
    await advance(199);
    expect(surface.peek.peekOpen).toBe(true);
    await movePointer(100);
    await advance(300);
    expect(surface.peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it.each(["touch", "pen"])("does not reveal for %s input", async (pointerType) => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await movePointer(2, { pointerType });
    await advance(500);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("does not open during a drag and keeps an existing preview until release", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await movePointer(2, { buttons: 1 });
    await advance(500);
    expect(surface.peek.peekOpen).toBe(false);
    await surface.reveal();
    await movePointer(400, { buttons: 1 });
    await advance(500);
    expect(surface.peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("keeps keyboard focus and editing alive, then closes when focus leaves", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    const editor = surface.panel.appendChild(document.createElement("input"));
    editor.focus();
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(true);
    editor.blur();
    await act(() => documentEvents.dispatchEvent(new Event("focusout")));
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("does not let pointer-focused links hold the preview open", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    const link = surface.panel.appendChild(document.createElement("a"));
    link.href = "#thread";
    link.textContent = "A thread";
    // Pointer focus does not activate :focus-visible on a link.
    await userEvent.click(link);
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("keeps popovers and fallback context menus usable outside the panel", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    surface.popupOpen = true;
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(true);
    surface.popupOpen = false;
    contextMenu.open = true;
    await movePointer(450);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(true);
    contextMenu.open = false;
    await movePointer(450);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("counts pointer movement inside React portals as remaining in the sidebar", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    const event = Object.assign(new Event("pointermove"), {
      pointerType: "mouse",
      clientX: 400,
      clientY: 300,
      buttons: 0,
    });
    await act(() => {
      surface.peek.onPointerMoveCapture({
        nativeEvent: event,
      } as ReactPointerEvent<HTMLDivElement>);
      documentEvents.dispatchEvent(event);
    });
    await advance(500);
    expect(surface.peek.peekOpen).toBe(true);
    await movePointer(500);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("dismisses with Escape and requires leaving the edge before revealing again", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    await act(() => documentEvents.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(surface.peek.peekOpen).toBe(false);
    await movePointer(2);
    await advance(500);
    expect(surface.peek.peekOpen).toBe(false);
    await movePointer(50);
    await surface.reveal();
  });

  it("leaves Escape to open menus", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    surface.popupOpen = true;
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    await act(() => documentEvents.dispatchEvent(escape));
    expect(surface.peek.peekOpen).toBe(true);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("closes when the mouse leaves the window", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    await act(() =>
      documentEvents.dispatchEvent(Object.assign(new Event("pointerout"), { relatedTarget: null })),
    );
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("holds the sidebar through a native context menu and resumes dismissal afterward", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await surface.reveal();
    const row = surface.panel.appendChild(document.createElement("div"));
    const contextEvent = new Event("contextmenu", { bubbles: true });
    await act(() => {
      row.dispatchEvent(contextEvent);
      windowEvents.dispatchEvent(new Event("blur"));
    });
    await advance(500);
    expect(surface.peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("cancels a pending reveal when the window loses focus", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();

    await movePointer(2);
    await act(() => windowEvents.dispatchEvent(new Event("blur")));
    await advance(500);
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("cancels delayed reveals when pinned or switched to mobile", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();
    await movePointer(2);
    await act(() => surface.renderSidebar(false));
    await advance(500);
    expect(surface.peek.peekOpen).toBe(false);
    await act(() => surface.renderSidebar());
    await surface.reveal();
    await act(() => surface.renderSidebar(false));
    expect(surface.peek.peekOpen).toBe(false);
    await act(() => surface.renderSidebar());
    expect(surface.peek.peekOpen).toBe(false);
  });

  it("clears timers when unmounted", async () => {
    await using surface = await createTestSurface();
    using _timers = fakeTimers();
    const { screen } = surface;

    await movePointer(2);
    await act(() => screen.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
