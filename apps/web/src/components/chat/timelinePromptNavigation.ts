import type { TimelinePromptKeybindingCommand } from "@t3tools/contracts";

export { isTimelinePromptKeybindingCommand } from "@t3tools/contracts";

export const TIMELINE_PROMPT_VIEW_OFFSET = 24;

const COMPACT_CHAT_SURFACE_SELECTOR = "[data-compact-chat-surface]";
const IGNORED_PROMPT_NAVIGATION_SELECTOR = [
  '[data-slot="dialog"]',
  '[role="dialog"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

export interface TimelinePromptNavigationItem {
  readonly rowIndex: number;
}

export interface TimelinePromptNavigationState {
  readonly scroll?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
}

type TimelinePromptNavigationListener = (
  command: TimelinePromptKeybindingCommand,
  eventTarget: EventTarget | null,
) => boolean;

const listeners = new Set<TimelinePromptNavigationListener>();

export function registerTimelinePromptNavigation(
  listener: TimelinePromptNavigationListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dispatchTimelinePromptNavigation(
  command: TimelinePromptKeybindingCommand,
  eventTarget: EventTarget | null,
): boolean {
  for (const listener of listeners) {
    if (listener(command, eventTarget)) return true;
  }
  return false;
}

export function timelineOwnsPromptNavigation(
  viewport: Element,
  eventTarget: EventTarget | null,
): boolean {
  const target =
    eventTarget instanceof Element
      ? eventTarget
      : document.activeElement instanceof Element
        ? document.activeElement
        : null;
  if (target?.closest(IGNORED_PROMPT_NAVIGATION_SELECTOR)) return false;

  const viewportCompactSurface = viewport.closest(COMPACT_CHAT_SURFACE_SELECTOR);
  const targetCompactSurface = target?.closest(COMPACT_CHAT_SURFACE_SELECTOR) ?? null;
  return viewportCompactSurface
    ? viewportCompactSurface === targetCompactSurface
    : targetCompactSurface === null;
}

export function resolveTimelinePromptNavigationTarget<
  Item extends TimelinePromptNavigationItem,
>(input: {
  readonly command: TimelinePromptKeybindingCommand;
  readonly items: ReadonlyArray<Item>;
  readonly state: TimelinePromptNavigationState | undefined;
  readonly pendingTargetRowIndex: number | null;
}): Item | null {
  const { command, items, state, pendingTargetRowIndex } = input;
  if (items.length === 0) return null;
  if (command === "timeline.firstPrompt") return items[0] ?? null;
  if (command === "timeline.lastPrompt") return items[items.length - 1] ?? null;

  const pendingIndex = items.findIndex((item) => item.rowIndex === pendingTargetRowIndex);
  if (pendingIndex !== -1) {
    const targetIndex = command === "timeline.previousPrompt" ? pendingIndex - 1 : pendingIndex + 1;
    return items[targetIndex] ?? null;
  }

  const scroll = state?.scroll;
  const positionAtIndex = state?.positionAtIndex;
  if (typeof scroll !== "number" || !Number.isFinite(scroll) || !positionAtIndex) return null;

  const anchor = scroll + TIMELINE_PROMPT_VIEW_OFFSET;
  let currentIndex = -1;
  let currentPosition: number | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    const position = positionAtIndex(item.rowIndex);
    if (typeof position !== "number" || !Number.isFinite(position)) continue;
    if (position > anchor + 1) break;
    currentIndex = index;
    currentPosition = position;
  }

  if (command === "timeline.nextPrompt") {
    return items[currentIndex + 1] ?? null;
  }

  if (currentIndex === -1) return null;
  const currentPromptIsAligned =
    currentPosition !== null && Math.abs(currentPosition - anchor) <= 1;
  return items[currentPromptIsAligned ? currentIndex - 1 : currentIndex] ?? null;
}
