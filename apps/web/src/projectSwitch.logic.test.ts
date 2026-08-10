import { describe, expect, it, vi } from "vite-plus/test";

import {
  handleProjectSwitchShortcut,
  isProjectSwitchAvailable,
  switchProject,
} from "./projectSwitch.logic";

describe("project switch availability", () => {
  it("requires the default sidebar and at least two logical projects", () => {
    expect(
      isProjectSwitchAvailable({
        legacySidebarEnabled: false,
        pathname: "/env/thread",
        projectGroupCount: 2,
      }),
    ).toBe(true);
    expect(
      isProjectSwitchAvailable({
        legacySidebarEnabled: false,
        pathname: "/env/thread",
        projectGroupCount: 1,
      }),
    ).toBe(false);
    expect(
      isProjectSwitchAvailable({
        legacySidebarEnabled: true,
        pathname: "/env/thread",
        projectGroupCount: 2,
      }),
    ).toBe(false);
    expect(
      isProjectSwitchAvailable({
        legacySidebarEnabled: false,
        pathname: "/settings/keybindings",
        projectGroupCount: 2,
      }),
    ).toBe(false);
  });
});

describe("handleProjectSwitchShortcut", () => {
  it("opens the picker even when another palette surface is already open", () => {
    const event = { repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const open = vi.fn();

    expect(
      handleProjectSwitchShortcut({
        command: "project.switch",
        available: true,
        event,
        open,
      }),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("ignores repeats and unavailable surfaces", () => {
    const open = vi.fn();
    const repeated = { repeat: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(
      handleProjectSwitchShortcut({
        command: "project.switch",
        available: true,
        event: repeated,
        open,
      }),
    ).toBe(false);
    expect(repeated.preventDefault).not.toHaveBeenCalled();

    expect(
      handleProjectSwitchShortcut({
        command: "project.switch",
        available: false,
        event: { repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
        open,
      }),
    ).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("switchProject", () => {
  it("starts the project chat before applying its sidebar scope", async () => {
    const calls: string[] = [];

    await switchProject({
      projectScopeKey: "project-two",
      startNewThread: async () => {
        calls.push("new-thread");
      },
      requestProjectScope: (scopeKey) => {
        calls.push(`scope:${scopeKey}`);
      },
    });

    expect(calls).toEqual(["new-thread", "scope:project-two"]);
  });

  it("does not change the sidebar scope when starting the chat fails", async () => {
    const requestProjectScope = vi.fn();

    await expect(
      switchProject({
        projectScopeKey: "project-two",
        startNewThread: async () => {
          throw new Error("failed");
        },
        requestProjectScope,
      }),
    ).rejects.toThrow("failed");
    expect(requestProjectScope).not.toHaveBeenCalled();
  });
});
