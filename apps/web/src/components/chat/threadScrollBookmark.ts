export interface TimelineScrollBookmark {
  readonly rowId: string;
  readonly offsetWithinRow: number;
}

interface TimelinePositionState {
  readonly end?: number;
  readonly scroll?: number;
  readonly start?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
  readonly sizeAtIndex?: (index: number) => number | undefined;
}

interface TimelineRowLike {
  readonly id: string;
}

export interface TimelineInitialScrollPosition {
  readonly index: number;
  readonly viewOffset: number;
}

const bookmarkByThreadKey = new Map<string, TimelineScrollBookmark>();

export function hasTimelineScrollBookmark(threadKey: string) {
  return bookmarkByThreadKey.has(threadKey);
}

export function clearTimelineScrollBookmark(threadKey: string) {
  bookmarkByThreadKey.delete(threadKey);
}

export function captureTimelineScrollBookmark(
  threadKey: string,
  rows: ReadonlyArray<TimelineRowLike>,
  state: TimelinePositionState | null | undefined,
  listHeaderSize = 0,
) {
  const bookmark = resolveTimelineScrollBookmark(rows, state, listHeaderSize);
  if (bookmark !== null) {
    bookmarkByThreadKey.set(threadKey, bookmark);
  }
  return bookmark;
}

export function resolveTimelineInitialScrollPosition(
  threadKey: string,
  rows: ReadonlyArray<TimelineRowLike>,
): TimelineInitialScrollPosition | null {
  const bookmark = bookmarkByThreadKey.get(threadKey);
  if (!bookmark) {
    return null;
  }

  const index = rows.findIndex((row) => row.id === bookmark.rowId);
  if (index < 0) {
    bookmarkByThreadKey.delete(threadKey);
    return null;
  }

  return {
    index,
    viewOffset: -bookmark.offsetWithinRow,
  };
}

function resolveTimelineScrollBookmark(
  rows: ReadonlyArray<TimelineRowLike>,
  state: TimelinePositionState | null | undefined,
  listHeaderSize: number,
): TimelineScrollBookmark | null {
  if (!state || rows.length === 0) {
    return null;
  }

  const scroll = state.scroll;
  const start = state.start;
  if (
    typeof scroll !== "number" ||
    !Number.isFinite(scroll) ||
    typeof start !== "number" ||
    !Number.isInteger(start)
  ) {
    return null;
  }

  const lastCandidate = Math.min(
    rows.length - 1,
    typeof state.end === "number" && Number.isInteger(state.end)
      ? Math.max(start, state.end)
      : rows.length - 1,
  );
  const leadingInset = Number.isFinite(listHeaderSize) ? Math.max(0, listHeaderSize) : 0;
  for (let index = Math.max(0, start); index <= lastCandidate; index += 1) {
    const row = rows[index];
    const rowTop = state.positionAtIndex?.(index);
    if (!row || typeof rowTop !== "number" || !Number.isFinite(rowTop)) {
      continue;
    }

    const rowHeight = state.sizeAtIndex?.(index);
    const rowTopWithInset = rowTop + leadingInset;
    if (
      rowTopWithInset < scroll &&
      typeof rowHeight === "number" &&
      Number.isFinite(rowHeight) &&
      rowTopWithInset + Math.max(1, rowHeight) <= scroll
    ) {
      continue;
    }

    return {
      rowId: row.id,
      offsetWithinRow: Math.max(0, scroll - rowTopWithInset),
    };
  }

  return null;
}
