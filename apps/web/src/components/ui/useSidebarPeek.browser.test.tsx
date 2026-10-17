import { act, useLayoutEffect, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSidebarPeek } from "./useSidebarPeek";

const contextMenu = vi.hoisted(() => ({ open: false }));
vi.mock("~/contextMenuFallback", () => ({ isContextMenuOpen: () => contextMenu.open }));

let root: Root;
let container: HTMLDivElement;
let panel: HTMLDivElement;
let peek: ReturnType<typeof useSidebarPeek>;
let popupOpen = false;
const documentEvents = document;
const windowEvents = window;

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

/** Opens the preview through its edge gesture. */
async function reveal() {
  await movePointer(2);
  await advance(300);
  expect(peek.peekOpen).toBe(true);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  popupOpen = false;
  contextMenu.open = false;
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => root.render(<SidebarFixture />));
  panel = container.querySelector<HTMLDivElement>("[data-sidebar-peek-fixture]")!;
  vi.spyOn(panel, "querySelector").mockImplementation(() =>
    popupOpen ? document.createElement("button") : null,
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("collapsed sidebar hover preview", () => {
  it("requires deliberate edge hover and tolerates briefly leaving the panel", async () => {
    await movePointer(2);
    await advance(299);
    expect(peek.peekOpen).toBe(false);
    await movePointer(30);
    await advance(300);
    expect(peek.peekOpen).toBe(false);
    await reveal();
    await movePointer(400);
    await advance(199);
    expect(peek.peekOpen).toBe(true);
    await movePointer(100);
    await advance(300);
    expect(peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it.each(["touch", "pen"])("does not reveal for %s input", async (pointerType) => {
    await movePointer(2, { pointerType });
    await advance(500);
    expect(peek.peekOpen).toBe(false);
  });

  it("does not open during a drag and keeps an existing preview until release", async () => {
    await movePointer(2, { buttons: 1 });
    await advance(500);
    expect(peek.peekOpen).toBe(false);
    await reveal();
    await movePointer(400, { buttons: 1 });
    await advance(500);
    expect(peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("keeps keyboard focus and editing alive, then closes when focus leaves", async () => {
    await reveal();
    const editor = panel.appendChild(document.createElement("input"));
    editor.focus();
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(true);
    editor.blur();
    await act(() => documentEvents.dispatchEvent(new Event("focusout")));
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("does not let pointer-focused links hold the preview open", async () => {
    await reveal();
    const link = panel.appendChild(document.createElement("a"));
    link.href = "#thread";
    link.textContent = "A thread";
    // Pointer focus does not activate :focus-visible on a link.
    await act(() => userEvent.click(link));
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("keeps popovers and fallback context menus usable outside the panel", async () => {
    await reveal();
    popupOpen = true;
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(true);
    popupOpen = false;
    contextMenu.open = true;
    await movePointer(450);
    await advance(200);
    expect(peek.peekOpen).toBe(true);
    contextMenu.open = false;
    await movePointer(450);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("counts pointer movement inside React portals as remaining in the sidebar", async () => {
    await reveal();
    const event = Object.assign(new Event("pointermove"), {
      pointerType: "mouse",
      clientX: 400,
      clientY: 300,
      buttons: 0,
    });
    await act(() => {
      peek.onPointerMoveCapture({ nativeEvent: event } as ReactPointerEvent<HTMLDivElement>);
      documentEvents.dispatchEvent(event);
    });
    await advance(500);
    expect(peek.peekOpen).toBe(true);
    await movePointer(500);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("dismisses with Escape and requires leaving the edge before revealing again", async () => {
    await reveal();
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    await act(() => documentEvents.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(peek.peekOpen).toBe(false);
    await movePointer(2);
    await advance(500);
    expect(peek.peekOpen).toBe(false);
    await movePointer(50);
    await reveal();
  });

  it("leaves Escape to open menus", async () => {
    await reveal();
    popupOpen = true;
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    await act(() => documentEvents.dispatchEvent(escape));
    expect(peek.peekOpen).toBe(true);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("closes when the mouse leaves the window", async () => {
    await reveal();
    await act(() =>
      documentEvents.dispatchEvent(Object.assign(new Event("pointerout"), { relatedTarget: null })),
    );
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("holds the sidebar through a native context menu and resumes dismissal afterward", async () => {
    await reveal();
    const row = panel.appendChild(document.createElement("div"));
    const contextEvent = new Event("contextmenu", { bubbles: true });
    await act(() => {
      row.dispatchEvent(contextEvent);
      windowEvents.dispatchEvent(new Event("blur"));
    });
    await advance(500);
    expect(peek.peekOpen).toBe(true);
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("cancels a pending reveal when the window loses focus", async () => {
    await movePointer(2);
    await act(() => windowEvents.dispatchEvent(new Event("blur")));
    await advance(500);
    expect(peek.peekOpen).toBe(false);
  });

  it("cancels delayed reveals when pinned or switched to mobile", async () => {
    await movePointer(2);
    await act(() => root.render(<SidebarFixture enabled={false} />));
    await advance(500);
    expect(peek.peekOpen).toBe(false);
    await act(() => root.render(<SidebarFixture />));
    await reveal();
    await act(() => root.render(<SidebarFixture enabled={false} />));
    expect(peek.peekOpen).toBe(false);
    await act(() => root.render(<SidebarFixture />));
    expect(peek.peekOpen).toBe(false);
  });

  it("clears timers when unmounted", async () => {
    await movePointer(2);
    await act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
