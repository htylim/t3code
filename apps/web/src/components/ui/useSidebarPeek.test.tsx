import { act, useLayoutEffect, type PointerEvent as ReactPointerEvent } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSidebarPeek } from "./useSidebarPeek";

const contextMenu = vi.hoisted(() => ({ open: false }));
vi.mock("~/contextMenuFallback", () => ({ isContextMenuOpen: () => contextMenu.open }));

/** Provides the focus and containment behavior used by the hover controller. */
class FocusTarget extends EventTarget {
  editing = false;
  insidePanel = false;

  /** Represents an editor or a keyboard-focused control. */
  matches() {
    return this.editing;
  }
}

let renderer: ReactTestRenderer;
let peek: ReturnType<typeof useSidebarPeek>;
let documentEvents: EventTarget & { activeElement: FocusTarget | null; querySelector: () => null };
let windowEvents: EventTarget;
let popupOpen = false;
const panel = {
  /** Supplies the on-screen panel bounds after reveal. */
  getBoundingClientRect: () => ({ left: 0, right: 280, top: 0, bottom: 900 }),
  /** Identifies controls that belong to the panel. */
  contains: (target: FocusTarget | null) => target?.insidePanel === true,
  /** Represents a sidebar popup trigger's expanded state. */
  querySelector: () => (popupOpen ? {} : null),
};

/** Mounts the real hook with a DOM stand-in; tests exercise event and timer behavior. */
function SidebarFixture({ enabled = true }: { enabled?: boolean }) {
  const sidebarPeek = useSidebarPeek(enabled);
  const { panelRef } = sidebarPeek;
  useLayoutEffect(() => {
    peek = sidebarPeek;
  });
  return <div ref={panelRef} />;
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
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("Node", FocusTarget);
  documentEvents = Object.assign(new EventTarget(), {
    activeElement: null,
    querySelector: () => null,
  });
  windowEvents = new EventTarget();
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("window", windowEvents);
  popupOpen = false;
  contextMenu.open = false;
  await act(() => {
    renderer = create(<SidebarFixture />, { createNodeMock: () => panel });
  });
});

afterEach(async () => {
  await act(() => renderer.unmount());
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
    const editor = new FocusTarget();
    editor.insidePanel = true;
    editor.editing = true;
    documentEvents.activeElement = editor;
    await movePointer(400);
    await advance(200);
    expect(peek.peekOpen).toBe(true);
    documentEvents.activeElement = null;
    await act(() => documentEvents.dispatchEvent(new Event("focusout")));
    await advance(200);
    expect(peek.peekOpen).toBe(false);
  });

  it("does not let pointer-focused links hold the preview open", async () => {
    await reveal();
    const link = new FocusTarget();
    link.insidePanel = true;
    documentEvents.activeElement = link;
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
    const row = new FocusTarget();
    row.insidePanel = true;
    const contextEvent = new Event("contextmenu");
    Object.defineProperty(contextEvent, "target", { value: row });
    await act(() => {
      documentEvents.dispatchEvent(contextEvent);
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
    await act(() => renderer.update(<SidebarFixture enabled={false} />));
    await advance(500);
    expect(peek.peekOpen).toBe(false);
    await act(() => renderer.update(<SidebarFixture />));
    await reveal();
    await act(() => renderer.update(<SidebarFixture enabled={false} />));
    expect(peek.peekOpen).toBe(false);
    await act(() => renderer.update(<SidebarFixture />));
    expect(peek.peekOpen).toBe(false);
  });

  it("clears timers when unmounted", async () => {
    await movePointer(2);
    await act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
