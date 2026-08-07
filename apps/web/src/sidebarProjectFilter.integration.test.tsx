import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  reduceCommandPaletteUiState,
  type CommandPaletteUiState,
} from "./components/CommandPalette.logic";
import { resolveShortcutCommand } from "./keybindings";
import {
  buildSidebarProjectFilterActionItems,
  handleSidebarProjectFilterShortcut,
  resolveSidebarProjectFilterLabel,
} from "./sidebarProjectFilter.logic";
import {
  requestSidebarProjectFilterScope,
  subscribeSidebarProjectFilterScope,
} from "./sidebarProjectFilterBus";
import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";
import type { Project } from "./types";

const environmentId = EnvironmentId.make("environment-local");

function makeProject(): Project {
  return {
    id: ProjectId.make("project-1"),
    environmentId,
    title: "T3 Code",
    workspaceRoot: "/workspace/t3code",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar project filter integration", () => {
  it("runs the configured shortcut through the picker into the mounted scope subscriber", async () => {
    const groups = buildSidebarProjectSnapshots({
      projects: [makeProject()],
      settings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      primaryEnvironmentId: environmentId,
      resolveEnvironmentLabel: () => null,
    });
    const keybindings = [
      {
        command: "sidebar.projectFilter",
        shortcut: {
          key: "p",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          shiftKey: true,
          altKey: false,
        },
        whenAst: {
          type: "not",
          node: { type: "identifier", name: "terminalFocus" },
        },
      },
    ] satisfies ResolvedKeybindingsConfig;
    const keyEvent = {
      key: "p",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      repeat: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    const command = resolveShortcutCommand(keyEvent, keybindings, {
      platform: "MacIntel",
      context: { terminalFocus: false },
    });
    let paletteState: CommandPaletteUiState = {
      open: true,
      mode: "files",
      openIntent: null,
    };

    const handled = handleSidebarProjectFilterShortcut({
      command,
      available: true,
      event: keyEvent,
      open: () => {
        paletteState = reduceCommandPaletteUiState(paletteState, {
          _tag: "OpenProjectFilter",
        });
      },
    });

    expect(handled).toBe(true);
    expect(paletteState).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "project-filter" },
    });

    let scopeKey: string | null = null;
    const selectedThreadKeys = new Set(["thread-1"]);
    const navigate = vi.fn();
    const unsubscribe = subscribeSidebarProjectFilterScope((nextScopeKey) => {
      scopeKey = nextScopeKey;
      selectedThreadKeys.clear();
    });
    const items = buildSidebarProjectFilterActionItems({
      groups,
      allProjectsIcon: null,
      projectIcon: () => null,
      requestScope: requestSidebarProjectFilterScope,
    });

    await items[1]?.run();
    expect(scopeKey).toBe(groups[0]?.projectKey);
    expect(resolveSidebarProjectFilterLabel(groups, scopeKey)).toBe("T3 Code");
    expect(selectedThreadKeys.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();

    paletteState = reduceCommandPaletteUiState(paletteState, { _tag: "SetOpen", open: false });
    expect(scopeKey).toBe(groups[0]?.projectKey);

    unsubscribe();
    requestSidebarProjectFilterScope(null);
    expect(scopeKey).toBe(groups[0]?.projectKey);
  });
});
