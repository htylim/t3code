import type { LegendListRef } from "@legendapp/list/react";
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { resolveTimelineInitialScrollPosition } from "./threadScrollBookmark";

/** Resolve a destination once per thread, after its rows become available. */
function createRestoration(
  threadKey: string,
  rows: ReadonlyArray<{ id: string }>,
  initialMount = false,
) {
  const position =
    rows.length > 0 ? resolveTimelineInitialScrollPosition(threadKey, rows) : undefined;
  return {
    threadKey,
    position,
    rowId: position ? rows[position.index]?.id : undefined,
    complete: initialMount && position === null,
  };
}

/** Restore reading positions without remounting the list or recording transitional scrolls. */
export function useThreadScrollRestoration({
  threadKey,
  rows,
  listRef,
  viewport,
  citationActive,
}: {
  threadKey: string;
  rows: ReadonlyArray<{ id: string }>;
  listRef: RefObject<LegendListRef | null>;
  viewport: HTMLElement | null;
  citationActive: boolean;
}) {
  const [restoration, setRestoration] = useState(() => createRestoration(threadKey, rows, true));
  const cancelRef = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => cancelRef.current?.(), []);
  if (
    restoration.threadKey !== threadKey ||
    (!restoration.complete && restoration.position === undefined && rows.length > 0)
  ) {
    setRestoration(createRestoration(threadKey, rows));
  } else if (citationActive && !restoration.complete) {
    setRestoration({ ...restoration, complete: true });
  }

  useLayoutEffect(() => {
    if (restoration.complete || restoration.position === undefined) return;
    const list = listRef.current;
    if (!list) return;
    let pending = true;

    /** Supersede LegendList's pending measurement work before another navigation takes over. */
    const stop = () => {
      if (!pending) return;
      pending = false;
      void list.scrollToOffset({
        // Legend may defer cancellation too, so read the user's position when it executes.
        get offset() {
          return list.getScrollableNode()?.scrollTop ?? list.getState().scroll;
        },
        animated: false,
      });
    };
    /** Let a user gesture own scrolling and allow subsequent events to save its position. */
    const cancel = () => {
      stop();
      setRestoration({ ...restoration, complete: true });
    };
    /** Keyboard navigation and sending take precedence over a pending restoration. */
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Enter"].includes(
          event.key,
        )
      ) {
        cancel();
      }
    };
    cancelRef.current = cancel;
    // Imperative list scrolling waits for the new data's measurements itself.
    const scrolling = restoration.position
      ? list.scrollToIndex({ ...restoration.position, viewPosition: 0, animated: false })
      : list.scrollToEnd({ animated: false });
    void scrolling.then(async () => {
      if (!pending) return;
      if (restoration.position && viewport) {
        const row = Array.from(
          viewport.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
        ).find((element) => element.dataset.timelineRowId === restoration.rowId);
        const scrollNode = list.getScrollableNode();
        if (row && scrollNode) {
          // A reused list can resolve its index scroll with the previous thread's header size.
          // Correct against the painted row before allowing scroll events to replace the bookmark.
          const delta =
            row.getBoundingClientRect().top -
            scrollNode.getBoundingClientRect().top -
            restoration.position.viewOffset;
          if (Math.abs(delta) > 0.5) {
            await list.scrollToOffset({ offset: scrollNode.scrollTop + delta, animated: false });
          }
        }
      }
      if (!pending) return;
      pending = false;
      setRestoration({ ...restoration, complete: true });
    });

    const ownerDocument = viewport?.ownerDocument;
    ownerDocument?.addEventListener("pointerdown", cancel, true);
    ownerDocument?.addEventListener("keydown", onKeyDown, true);
    viewport?.addEventListener("wheel", cancel, { passive: true });
    viewport?.addEventListener("touchmove", cancel, { passive: true });
    return () => {
      stop();
      cancelRef.current = null;
      ownerDocument?.removeEventListener("pointerdown", cancel, true);
      ownerDocument?.removeEventListener("keydown", onKeyDown, true);
      viewport?.removeEventListener("wheel", cancel);
      viewport?.removeEventListener("touchmove", cancel);
    };
  }, [listRef, restoration, viewport]);

  return {
    initialPosition: restoration.position ?? null,
    positioning: !restoration.complete && !citationActive,
    cancel,
  };
}
