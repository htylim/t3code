import { act, render as renderScreen, stubGlobal } from "../../test/render";
import { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";

import { RightPanelTabs } from "./RightPanelTabs";

vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/browser/browserDefaults", () => ({ useBrowserDefaults: () => ({ profiles: [] }) }));
const noop = () => undefined;

/** Own the rendered tree and fixture cleanup for one test. */
async function createTestSurface() {
  await using cleanup = new AsyncDisposableStack();
  const addFiles = vi.fn();
  cleanup.use(
    stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    ),
  );
  cleanup.use(vi.spyOn(Element.prototype, "getAnimations").mockReturnValue([]));
  cleanup.use(vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel"));
  const container = document.createElement("div");
  document.body.append(container);
  const screen = cleanup.use(await renderScreen(null, { container }));

  async function renderPanel(overrides: Partial<ComponentProps<typeof RightPanelTabs>> = {}) {
    await act(() =>
      screen.rerender(
        <RightPanelTabs
          mode="inline"
          open
          keybindings={compileResolvedKeybindingsConfig([
            { key: "mod+t", command: "rightPanel.new", when: "rightPanelOpen && !terminalFocus" },
          ])}
          getShortcutContext={() => ({
            rightPanelOpen: true,
            terminalFocus: false,
            terminalOpen: false,
            previewFocus: false,
            previewOpen: false,
            isWeb: true,
            isDesktop: false,
          })}
          surfaces={[]}
          environmentId={null}
          activeSurfaceId={null}
          pendingSurfaceIds={new Set()}
          previewSessions={{}}
          desktopByTabId={{}}
          terminalLabelsById={new Map()}
          onActivate={noop}
          onCloseSurface={noop}
          onCloseOtherSurfaces={noop}
          onCloseSurfacesToRight={noop}
          onCloseAllSurfaces={noop}
          onCopyFilePath={noop}
          onAddBrowser={noop}
          onAddBrowserInProfile={noop}
          onAddTerminal={noop}
          onAddDiff={noop}
          onAddFiles={addFiles}
          onAddPullRequest={noop}
          onAddPullRequests={noop}
          onAddDevice={noop}
          browserAvailable={false}
          terminalAvailable={false}
          diffAvailable={false}
          filesAvailable
          pullRequestAvailable={false}
          pullRequestsAvailable={false}
          deviceAvailable={false}
          {...overrides}
        >
          content
        </RightPanelTabs>,
      ),
    );
  }
  return {
    screen,
    container,
    renderPanel,
    addFiles,
    cleanup: cleanup.move(),
    async [Symbol.asyncDispose]() {
      await this.cleanup.disposeAsync();
    },
  };
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(() => (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}

describe("right panel new-tab shortcut", () => {
  it("leaves the fork's default side-chat shortcut to the chat view", async () => {
    await using surface = await createTestSurface();
    const { renderPanel } = surface;

    await renderPanel({ keybindings: DEFAULT_RESOLVED_KEYBINDINGS });
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "opens the menu on %s and chooses a tab",
    async (platform) => {
      await using surface = await createTestSurface();
      const { renderPanel } = surface;

      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await renderPanel();
      const event = await press(
        "t",
        platform === "MacIntel" ? { metaKey: true } : { ctrlKey: true },
      );
      expect(event.defaultPrevented).toBe(true);
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "Linked pull requests",
      );
      expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();
      expect(
        (
          await press("t", {
            metaKey: platform === "MacIntel",
            ctrlKey: platform !== "MacIntel",
            repeat: true,
          })
        ).defaultPrevented,
      ).toBe(true);
      await press("f");
      expect(surface.addFiles).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
    },
  );

  it("opens Files while a closed popup remains mounted", async () => {
    await using surface = await createTestSurface();
    const { container, renderPanel } = surface;

    await renderPanel();
    const popup = document.createElement("div");
    popup.dataset.slot = "menu-popup";
    popup.dataset.closed = "";
    container.append(popup);

    expect((await press("f")).defaultPrevented).toBe(true);
    expect(surface.addFiles).toHaveBeenCalledOnce();
  });

  it("opens the add-surface menu while a closed popup remains mounted", async () => {
    await using surface = await createTestSurface();
    const { container, renderPanel } = surface;

    await renderPanel();
    const popup = document.createElement("div");
    popup.dataset.slot = "menu-popup";
    popup.dataset.closed = "";
    container.append(popup);

    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(true);
    expect(document.querySelector('[role="menu"]:not([data-closed])')).not.toBeNull();
  });

  it("leaves the shortcut alone while the mounted panel is closed", async () => {
    await using surface = await createTestSurface();
    const { renderPanel } = surface;

    await renderPanel({ open: false });
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
  });

  it.each(["Win32", "Linux x86_64"])(
    "leaves Ctrl+T for the focused terminal on %s",
    async (platform) => {
      await using surface = await createTestSurface();
      const { container, renderPanel } = surface;

      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await renderPanel({
        getShortcutContext: () => ({
          rightPanelOpen: true,
          terminalFocus: true,
          terminalOpen: true,
          previewFocus: false,
          previewOpen: false,
          isWeb: true,
          isDesktop: false,
        }),
      });
      const terminal = document.createElement("textarea");
      const onKeyDown = vi.fn();
      terminal.addEventListener("keydown", onKeyDown);
      container.append(terminal);
      await act(() => terminal.focus());
      const event = await press("t", { ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(onKeyDown).toHaveBeenCalledWith(event);
      expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
    },
  );

  it("uses a custom binding from a text field and closes on Escape", async () => {
    await using surface = await createTestSurface();
    const { container, renderPanel } = surface;

    const input = document.createElement("input");
    await renderPanel({
      keybindings: compileResolvedKeybindingsConfig([{ key: "mod+y", command: "rightPanel.new" }]),
    });
    document.body.append(input);
    input.focus();
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(false);
    await press("y", { metaKey: true });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await press("Escape");
    expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
    const trigger = container.querySelector('[aria-label="Add panel surface"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    input.remove();
  });

  it("does not open over another popup or during text composition", async () => {
    await using surface = await createTestSurface();
    const { container, renderPanel } = surface;

    await renderPanel();
    expect((await press("t", { metaKey: true, isComposing: true })).defaultPrevented).toBe(false);
    const dialog = document.createElement("div");
    dialog.dataset.slot = "dialog-popup";
    container.append(dialog);
    for (const state of ["data-open", "data-ending-style"]) {
      dialog.setAttribute(state, "");
      expect((await press("f")).defaultPrevented, state).toBe(false);
      expect(surface.addFiles, state).not.toHaveBeenCalled();
      expect((await press("t", { metaKey: true })).defaultPrevented, state).toBe(false);
      expect(document.querySelector('[role="menu"]'), state).toBeNull();
      dialog.removeAttribute(state);
    }
  });

  it("supports arrow keys with an existing tab in sheet mode and clears the menu on close", async () => {
    await using surface = await createTestSurface();
    const { renderPanel } = surface;

    const panel = {
      mode: "sheet" as const,
      surfaces: [{ id: "files" as const, kind: "files" as const }],
    };
    await renderPanel(panel);
    await press("t", { metaKey: true });
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(document.activeElement?.textContent).toContain("Files");
    await press("Enter");
    expect(surface.addFiles).toHaveBeenCalledOnce();
    await press("t", { metaKey: true });
    await renderPanel({ ...panel, open: false });
    expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
    await renderPanel(panel);
    expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
  });
});
