import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isPreviewFocused } from "./previewFocus";

/** Represents focus inside the shared right panel, including nested chat content. */
class FocusTarget {
  isConnected = true;
  tagName = "DIV";
  ancestorSelectors = new Set<string>();

  /** Return an ancestor for the focus scopes present in this fixture. */
  closest(selector: string) {
    return this.ancestorSelectors.has(selector) ? this : null;
  }
}

describe("preview shortcut focus", () => {
  let focusedTarget: FocusTarget;

  beforeEach(() => {
    focusedTarget = new FocusTarget();
    vi.stubGlobal("HTMLElement", FocusTarget);
    vi.stubGlobal("document", {
      get activeElement() {
        return focusedTarget;
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps side-chat shortcuts available inside the shared preview-panel wrapper", () => {
    focusedTarget.ancestorSelectors.add("[data-preview-panel-mode]");
    focusedTarget.ancestorSelectors.add("[data-compact-chat-surface]");

    expect(isPreviewFocused()).toBe(false);
  });

  it("reserves preview shortcuts for browser controls and embedded webviews", () => {
    focusedTarget.ancestorSelectors.add("[data-preview-panel-mode]");
    expect(isPreviewFocused()).toBe(true);

    focusedTarget.ancestorSelectors.clear();
    focusedTarget.tagName = "WEBVIEW";
    expect(isPreviewFocused()).toBe(true);
  });

  it("does not claim ordinary editors or disconnected preview controls", () => {
    expect(isPreviewFocused()).toBe(false);

    focusedTarget.ancestorSelectors.add("[data-preview-panel-mode]");
    focusedTarget.isConnected = false;
    expect(isPreviewFocused()).toBe(false);
  });
});
