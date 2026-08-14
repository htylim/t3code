import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  captureTimelineScrollBookmark,
  clearTimelineScrollBookmark,
  hasTimelineScrollBookmark,
  resolveTimelineInitialScrollPosition,
} from "./threadScrollBookmark";

const THREAD_KEY = "environment-local:thread-1";

afterEach(() => {
  clearTimelineScrollBookmark(THREAD_KEY);
});

describe("thread scroll bookmarks", () => {
  it("captures the first visible row and its offset", () => {
    const rows = [{ id: "first" }, { id: "second" }, { id: "third" }];

    expect(
      captureTimelineScrollBookmark(THREAD_KEY, rows, {
        start: 0,
        end: 2,
        scroll: 125,
        positionAtIndex: (index) => [0, 100, 240][index],
        sizeAtIndex: (index) => [100, 140, 90][index],
      }),
    ).toEqual({ rowId: "second", offsetWithinRow: 25 });
    expect(hasTimelineScrollBookmark(THREAD_KEY)).toBe(true);
  });

  it("excludes the list header from the offset within a row", () => {
    const rows = [{ id: "first" }, { id: "second" }];

    expect(
      captureTimelineScrollBookmark(
        THREAD_KEY,
        rows,
        {
          start: 0,
          end: 1,
          scroll: 173,
          positionAtIndex: (index) => [0, 100][index],
          sizeAtIndex: (index) => [100, 140][index],
        },
        48,
      ),
    ).toEqual({ rowId: "second", offsetWithinRow: 25 });
  });

  it("restores by row id when rows move", () => {
    captureTimelineScrollBookmark(THREAD_KEY, [{ id: "second" }], {
      start: 0,
      scroll: 25,
      positionAtIndex: () => 0,
      sizeAtIndex: () => 100,
    });

    expect(
      resolveTimelineInitialScrollPosition(THREAD_KEY, [
        { id: "inserted" },
        { id: "first" },
        { id: "second" },
      ]),
    ).toEqual({ index: 2, viewOffset: -25 });
  });

  it("falls back when the bookmarked row is unavailable", () => {
    captureTimelineScrollBookmark(THREAD_KEY, [{ id: "missing" }], {
      start: 0,
      scroll: 10,
      positionAtIndex: () => 0,
      sizeAtIndex: () => 100,
    });

    expect(resolveTimelineInitialScrollPosition(THREAD_KEY, [{ id: "first" }])).toBeNull();
    expect(hasTimelineScrollBookmark(THREAD_KEY)).toBe(false);
  });

  it("clears a saved position at the live edge", () => {
    captureTimelineScrollBookmark(THREAD_KEY, [{ id: "first" }], {
      start: 0,
      scroll: 10,
      positionAtIndex: () => 0,
      sizeAtIndex: () => 100,
    });

    clearTimelineScrollBookmark(THREAD_KEY);

    expect(hasTimelineScrollBookmark(THREAD_KEY)).toBe(false);
    expect(resolveTimelineInitialScrollPosition(THREAD_KEY, [{ id: "first" }])).toBeNull();
  });

  it("ignores unusable list state", () => {
    expect(
      captureTimelineScrollBookmark(THREAD_KEY, [{ id: "first" }], {
        start: 0,
        scroll: Number.NaN,
        positionAtIndex: () => 0,
      }),
    ).toBeNull();
    expect(hasTimelineScrollBookmark(THREAD_KEY)).toBe(false);
  });
});
