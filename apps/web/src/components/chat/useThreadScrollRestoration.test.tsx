import type { LegendListRef } from "@legendapp/list/react";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { captureTimelineScrollBookmark, clearTimelineScrollBookmark } from "./threadScrollBookmark";
import { useThreadScrollRestoration } from "./useThreadScrollRestoration";

const THREAD_KEY = "restoration-test:thread";
const ROWS = [{ id: "first" }, { id: "second" }];
let renderer: ReactTestRenderer | undefined;
let scrollTop: number;
let pendingScroll: { apply: () => void; finish: () => void } | undefined;
let viewport: EventTarget & {
  ownerDocument: EventTarget;
  querySelectorAll: () => Array<{
    dataset: { timelineRowId: string };
    getBoundingClientRect: () => { top: number };
  }>;
};
let listRef: { current: LegendListRef | null };
let restoration: ReturnType<typeof useThreadScrollRestoration>;

/** Defer the physical scroll until the test signals that row measurements are ready. */
function queueScroll(readOffset: () => number) {
  pendingScroll?.finish();
  return new Promise<void>((finish) => {
    pendingScroll = {
      apply: () => {
        scrollTop = readOffset();
      },
      finish,
    };
  });
}

/** Exercise the production hook through mounted React updates. */
function RestorationProbe({
  rows = ROWS,
  citationActive = false,
}: {
  rows?: typeof ROWS;
  citationActive?: boolean;
}) {
  const currentRestoration = useThreadScrollRestoration({
    threadKey: THREAD_KEY,
    rows,
    citationActive,
    listRef,
    viewport: viewport as unknown as HTMLElement,
  });
  useLayoutEffect(() => {
    restoration = currentRestoration;
  });
  return null;
}

/** Finish the latest scroll operation, including superseding cancellation requests. */
async function settleScroll() {
  await act(() => {
    const pending = pendingScroll;
    pendingScroll = undefined;
    pending?.apply();
    pending?.finish();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrollTop = 100;
  pendingScroll = undefined;
  viewport = Object.assign(new EventTarget(), {
    ownerDocument: new EventTarget(),
    querySelectorAll: () => [],
  });
  listRef = {
    current: {
      getScrollableNode: () => ({ scrollTop, getBoundingClientRect: () => ({ top: 0 }) }),
      scrollToIndex: ({ index, viewOffset = 0 }: { index: number; viewOffset?: number }) =>
        queueScroll(() => index * 100 - viewOffset),
      scrollToEnd: () => queueScroll(() => 100),
      scrollToOffset: (options: { offset: number }) => queueScroll(() => options.offset),
    } as unknown as LegendListRef,
  };
  captureTimelineScrollBookmark(THREAD_KEY, ROWS, {
    start: 0,
    scroll: 25,
    positionAtIndex: (index) => index * 100,
    sizeAtIndex: () => 100,
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  clearTimelineScrollBookmark(THREAD_KEY);
  vi.unstubAllGlobals();
});

describe("mounted thread scroll restoration", () => {
  it("corrects the painted offset when the previous thread's header affected the index scroll", async () => {
    viewport.querySelectorAll = () => [
      {
        dataset: { timelineRowId: "first" },
        getBoundingClientRect: () => ({ top: 8 - scrollTop }),
      },
    ];
    await act(() => {
      renderer = create(<RestorationProbe />);
    });
    await settleScroll();
    expect(restoration.positioning).toBe(true);
    await settleScroll();
    expect(scrollTop).toBe(33);
    expect(8 - scrollTop).toBe(-25);
    expect(restoration.positioning).toBe(false);
  });

  it("waits for rows without discarding the saved position", async () => {
    await act(() => {
      renderer = create(<RestorationProbe rows={[]} />);
    });
    expect(pendingScroll).toBeUndefined();
    await act(() => renderer!.update(<RestorationProbe />));
    expect(restoration.positioning).toBe(true);
    await settleScroll();
    expect(scrollTop).toBe(25);
    expect(restoration.positioning).toBe(false);
  });

  it.each(["wheel", "touchmove", "pointerdown", "keydown"])(
    "lets %s navigation supersede restoration, even when cancellation is deferred",
    async (eventType) => {
      await act(() => {
        renderer = create(<RestorationProbe />);
      });
      await act(() => {
        const event = Object.assign(new Event(eventType), { key: "PageUp" });
        const target =
          eventType === "wheel" || eventType === "touchmove" ? viewport : viewport.ownerDocument;
        target.dispatchEvent(event);
        scrollTop = 70;
      });
      await settleScroll();
      expect(scrollTop).toBe(70);
      expect(restoration.positioning).toBe(false);
    },
  );

  it("gives an incoming citation priority over a pending bookmark restore", async () => {
    await act(() => {
      renderer = create(<RestorationProbe />);
    });
    await act(() => renderer!.update(<RestorationProbe citationActive />));
    await act(() => {
      scrollTop = 60;
    });
    await settleScroll();
    expect(scrollTop).toBe(60);
    expect(restoration.positioning).toBe(false);
    await act(() => renderer!.update(<RestorationProbe />));
    expect(pendingScroll).toBeUndefined();
  });

  it("does not start a bookmark restore when opening a citation", async () => {
    await act(() => {
      renderer = create(<RestorationProbe citationActive />);
    });
    expect(pendingScroll).toBeUndefined();
    expect(restoration.positioning).toBe(false);
  });
});
