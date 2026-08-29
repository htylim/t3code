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

export function resolveTimelinePromptNavigationIndex(input: {
  readonly command: TimelinePromptKeybindingCommand;
  readonly items: ReadonlyArray<TimelinePromptNavigationItem>;
  readonly currentRowIndex: number | undefined;
  readonly selectedIndex: number | null;
  readonly selectedPromptIsVisible: boolean;
  readonly navigationPending: boolean;
}): number | null {
  const {
    command,
    items,
    currentRowIndex,
    selectedIndex,
    selectedPromptIsVisible,
    navigationPending,
  } = input;
  const lastIndex = items.length - 1;
  if (lastIndex < 0) return null;
  if (command === "timeline.firstPrompt") return 0;
  if (command === "timeline.lastPrompt") return lastIndex;

  let visiblePromptIndex = -1;
  if (currentRowIndex !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || item.rowIndex > currentRowIndex) break;
      visiblePromptIndex = index;
    }
  }

  const hasSelectedPrompt =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex <= lastIndex;
  const continuesSelection = hasSelectedPrompt && (selectedPromptIsVisible || navigationPending);

  if (command === "timeline.nextPrompt") {
    const targetIndex = (continuesSelection ? selectedIndex : visiblePromptIndex) + 1;
    return targetIndex <= lastIndex ? targetIndex : null;
  }

  if (continuesSelection) {
    const targetIndex = selectedIndex - 1;
    return targetIndex >= 0 ? targetIndex : null;
  }

  if (visiblePromptIndex === -1 || currentRowIndex === undefined) return null;
  const visiblePrompt = items[visiblePromptIndex];
  if (!visiblePrompt) return null;

  // When the first visible row belongs to a response, the first "previous"
  // selects the prompt that owns it. Once that prompt is selected, subsequent
  // commands move only through prompt indices.
  const targetIndex =
    visiblePrompt.rowIndex === currentRowIndex ? visiblePromptIndex - 1 : visiblePromptIndex;
  return targetIndex >= 0 ? targetIndex : null;
}
