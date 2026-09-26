import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isContextMenuOpen } from "~/contextMenuFallback";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 200;
const EDGE_WIDTH_PX = 6;

/** Reveals a collapsed sidebar without changing its pinned state or moving keyboard focus. */
export function useSidebarPeek(enabled: boolean) {
  const [peekOpen, setPeekOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const portalPointerEvent = useRef<PointerEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let visible = false;
    let pointerInside = false;
    let dragging = false;
    let contextMenuActive = false;
    let dismissedAtEdge = false;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    /** Cancels delayed work when intent changes or the sidebar unmounts. */
    function clearTimers() {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      openTimer = undefined;
      closeTimer = undefined;
    }

    /** Keeps editors, keyboard navigation, and open sidebar popups usable beyond the panel edge. */
    function interactionActive() {
      const panel = panelRef.current;
      const focused = document.activeElement;
      const editingOrKeyboardFocus =
        focused instanceof HTMLElement &&
        panel?.contains(focused) &&
        focused.matches("input, textarea, [contenteditable=true], :focus-visible");
      return (
        dragging ||
        contextMenuActive ||
        isContextMenuOpen() ||
        editingOrKeyboardFocus ||
        Boolean(panel?.querySelector('[aria-haspopup][aria-expanded="true"]'))
      );
    }

    /** Closes only after the pointer has left and any active interaction has finished. */
    function scheduleClose() {
      clearTimeout(openTimer);
      openTimer = undefined;
      if (!visible || closeTimer !== undefined) return;
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        if (pointerInside || interactionActive()) return;
        visible = false;
        setPeekOpen(false);
      }, CLOSE_DELAY_MS);
    }

    /** Tracks intent with refs so ordinary mouse movement never rerenders the sidebar. */
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      contextMenuActive = false;
      dragging = event.buttons !== 0;
      const atEdge = event.clientX >= 0 && event.clientX <= EDGE_WIDTH_PX;
      if (!atEdge) dismissedAtEdge = false;
      const bounds = visible ? panelRef.current?.getBoundingClientRect() : undefined;
      pointerInside =
        visible &&
        (portalPointerEvent.current === event ||
          (bounds !== undefined &&
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom));
      if (pointerInside) {
        clearTimers();
      } else if (atEdge && !dismissedAtEdge && !dragging && !visible) {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (openTimer !== undefined) return;
        openTimer = setTimeout(() => {
          openTimer = undefined;
          visible = true;
          pointerInside = true;
          setPeekOpen(true);
        }, OPEN_DELAY_MS);
      } else {
        scheduleClose();
      }
    }

    /** Handles leaving the window, where there may be no subsequent pointer movement. */
    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget !== null) return;
      pointerInside = false;
      scheduleClose();
    }

    /** Treats switching windows as leaving the panel, except during a native menu. */
    function handleWindowBlur() {
      pointerInside = false;
      scheduleClose();
    }

    /** Waits for a native context menu to return control before hiding its sidebar. */
    function handleContextMenu(event: MouseEvent) {
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) return;
      contextMenuActive = true;
      clearTimers();
    }

    /** Lets nested menus consume Escape first and prevents reopening until the pointer leaves the edge. */
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || !visible) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (contextMenuActive || isContextMenuOpen()) return;
      if (panelRef.current?.querySelector('[aria-haspopup][aria-expanded="true"]')) return;
      clearTimers();
      visible = false;
      dismissedAtEdge = true;
      if (panelRef.current?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>("[data-sidebar-control] button")?.focus();
      }
      setPeekOpen(false);
      event.preventDefault();
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerdown", handlePointerMove);
    document.addEventListener("pointerup", handlePointerMove);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("focusout", scheduleClose);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      clearTimers();
      setPeekOpen(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerMove);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("focusout", scheduleClose);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [enabled]);

  /** React capture also sees events from sidebar popovers rendered into portals. */
  function onPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
    portalPointerEvent.current = event.nativeEvent;
  }

  return { peekOpen: enabled && peekOpen, panelRef, onPointerMoveCapture };
}
