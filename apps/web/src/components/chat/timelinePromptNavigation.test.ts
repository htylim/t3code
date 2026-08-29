import { describe, expect, it } from "vite-plus/test";
import { TIMELINE_PROMPT_KEYBINDING_COMMANDS } from "@t3tools/contracts";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";

import { resolveTimelinePromptNavigationIndex } from "./timelinePromptNavigation";

const items = [{ rowIndex: 0 }, { rowIndex: 3 }, { rowIndex: 7 }, { rowIndex: 11 }];

const resolveIndex = (
  input: Partial<Parameters<typeof resolveTimelinePromptNavigationIndex>[0]> &
    Pick<Parameters<typeof resolveTimelinePromptNavigationIndex>[0], "command">,
) =>
  resolveTimelinePromptNavigationIndex({
    items,
    currentRowIndex: undefined,
    selectedIndex: null,
    selectedPromptIsVisible: false,
    navigationPending: false,
    ...input,
  });

describe("timeline prompt navigation", () => {
  it("leaves all four commands unbound by default", () => {
    expect(
      DEFAULT_KEYBINDINGS.filter((binding) =>
        TIMELINE_PROMPT_KEYBINDING_COMMANDS.some((command) => command === binding.command),
      ),
    ).toEqual([]);
  });

  it("selects the prompt owning the visible response", () => {
    expect(resolveIndex({ command: "timeline.previousPrompt", currentRowIndex: 5 })).toBe(1);
    expect(resolveIndex({ command: "timeline.nextPrompt", currentRowIndex: 5 })).toBe(2);
  });

  it("moves before a prompt that is already the first visible row", () => {
    expect(resolveIndex({ command: "timeline.previousPrompt", currentRowIndex: 7 })).toBe(1);
  });

  it("continues through selected prompt indices after each settled jump", () => {
    expect(
      resolveIndex({
        command: "timeline.previousPrompt",
        currentRowIndex: 7,
        selectedIndex: 2,
        selectedPromptIsVisible: true,
      }),
    ).toBe(1);
    expect(
      resolveIndex({
        command: "timeline.previousPrompt",
        currentRowIndex: 3,
        selectedIndex: 1,
        selectedPromptIsVisible: true,
      }),
    ).toBe(0);
    expect(
      resolveIndex({
        command: "timeline.nextPrompt",
        currentRowIndex: 2,
        selectedIndex: 1,
        selectedPromptIsVisible: true,
      }),
    ).toBe(2);
  });

  it("continues from the selected index before the viewport settles", () => {
    expect(
      resolveIndex({
        command: "timeline.previousPrompt",
        currentRowIndex: 7,
        selectedIndex: 1,
        navigationPending: true,
      }),
    ).toBe(0);
    expect(
      resolveIndex({
        command: "timeline.nextPrompt",
        currentRowIndex: 3,
        selectedIndex: 2,
        navigationPending: true,
      }),
    ).toBe(3);
  });

  it("uses the visible prompt after manual scrolling moves the selection out of view", () => {
    expect(
      resolveIndex({
        command: "timeline.previousPrompt",
        currentRowIndex: 5,
        selectedIndex: 3,
        selectedPromptIsVisible: false,
      }),
    ).toBe(1);
  });

  it("jumps to the first and last loaded prompts without a visible row", () => {
    expect(resolveIndex({ command: "timeline.firstPrompt" })).toBe(0);
    expect(resolveIndex({ command: "timeline.lastPrompt" })).toBe(3);
  });

  it("does nothing past either boundary", () => {
    expect(
      resolveIndex({
        command: "timeline.previousPrompt",
        currentRowIndex: 0,
        selectedIndex: 0,
        selectedPromptIsVisible: true,
      }),
    ).toBeNull();
    expect(
      resolveIndex({
        command: "timeline.nextPrompt",
        currentRowIndex: 11,
        selectedIndex: 3,
        selectedPromptIsVisible: true,
      }),
    ).toBeNull();
  });
});
