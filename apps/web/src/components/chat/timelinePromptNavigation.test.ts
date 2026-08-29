import { describe, expect, it } from "vite-plus/test";
import { TIMELINE_PROMPT_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { resolveTimelinePromptNavigationTarget } from "./timelinePromptNavigation";

const items = [{ rowIndex: 0 }, { rowIndex: 3 }, { rowIndex: 7 }, { rowIndex: 11 }];
const positions = new Map([
  [0, 100],
  [3, 500],
  [7, 900],
  [11, 1300],
]);
const state = (scroll: number) => ({
  scroll,
  positionAtIndex: (index: number) => positions.get(index),
});

describe("timeline prompt navigation", () => {
  it("leaves all four commands unbound by default", () => {
    expect(
      DEFAULT_KEYBINDINGS.filter((binding) =>
        TIMELINE_PROMPT_KEYBINDING_COMMANDS.some((command) => command === binding.command),
      ),
    ).toEqual([]);
  });

  it("moves to the prompt owning the visible response, then to the previous prompt", () => {
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.previousPrompt",
        items,
        state: state(700),
        pendingTargetRowIndex: null,
      }),
    ).toEqual({ rowIndex: 3 });

    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.previousPrompt",
        items,
        state: state(476),
        pendingTargetRowIndex: null,
      }),
    ).toEqual({ rowIndex: 0 });
  });

  it("moves down to the next prompt", () => {
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.nextPrompt",
        items,
        state: state(700),
        pendingTargetRowIndex: null,
      }),
    ).toEqual({ rowIndex: 7 });
  });

  it("uses the pending target during rapid key repeats", () => {
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.nextPrompt",
        items,
        state: state(100),
        pendingTargetRowIndex: 7,
      }),
    ).toEqual({ rowIndex: 11 });
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.previousPrompt",
        items,
        state: state(100),
        pendingTargetRowIndex: 7,
      }),
    ).toEqual({ rowIndex: 3 });
  });

  it("jumps to the first and last loaded prompts without needing list geometry", () => {
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.firstPrompt",
        items,
        state: undefined,
        pendingTargetRowIndex: null,
      }),
    ).toEqual({ rowIndex: 0 });
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.lastPrompt",
        items,
        state: undefined,
        pendingTargetRowIndex: null,
      }),
    ).toEqual({ rowIndex: 11 });
  });

  it("does nothing past either boundary", () => {
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.previousPrompt",
        items,
        state: state(76),
        pendingTargetRowIndex: null,
      }),
    ).toBeNull();
    expect(
      resolveTimelinePromptNavigationTarget({
        command: "timeline.nextPrompt",
        items,
        state: state(1500),
        pendingTargetRowIndex: null,
      }),
    ).toBeNull();
  });
});
