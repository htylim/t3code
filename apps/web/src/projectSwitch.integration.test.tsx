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
import { handleProjectSwitchShortcut, switchProject } from "./projectSwitch.logic";
import { resolveSidebarProjectFilterLabel } from "./sidebarProjectFilter.logic";
import {
  requestSidebarProjectFilterScope,
  subscribeSidebarProjectFilterScope,
} from "./sidebarProjectFilterBus";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
} from "./sidebarProjectGrouping";
import type { Project } from "./types";

const environmentId = EnvironmentId.make("environment-local");

function makeProject(id: string, title: string, workspaceRoot: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title,
    workspaceRoot,
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

describe("project switch integration", () => {
  it("runs the configured shortcut through project selection into a new chat and sidebar scope", async () => {
    const groups = buildSidebarProjectSnapshots({
      projects: [
        makeProject("project-1", "T3 Code", "/workspace/t3code"),
        makeProject("project-2", "Effect", "/workspace/effect"),
      ],
      settings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      primaryEnvironmentId: environmentId,
      resolveEnvironmentLabel: () => null,
    });
    const keybindings = [
      {
        command: "project.switch",
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

    const handled = handleProjectSwitchShortcut({
      command,
      available: true,
      event: keyEvent,
      open: () => {
        paletteState = reduceCommandPaletteUiState(paletteState, {
          _tag: "OpenProjectSwitch",
        });
      },
    });

    expect(handled).toBe(true);
    expect(paletteState).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "project-switch" },
    });

    const entries = buildSidebarProjectPickerEntries({
      groups,
      preferredProjectRef: null,
    });
    const selected = entries[1]!;
    let scopeKey: string | null = null;
    const selectedThreadKeys = new Set(["thread-1"]);
    const startNewThread = vi.fn(async () => undefined);
    const unsubscribe = subscribeSidebarProjectFilterScope((nextScopeKey) => {
      scopeKey = nextScopeKey;
      selectedThreadKeys.clear();
    });

    await switchProject({
      projectScopeKey: selected.group.projectKey,
      startNewThread,
      requestProjectScope: requestSidebarProjectFilterScope,
    });

    expect(startNewThread).toHaveBeenCalledOnce();
    expect(scopeKey).toBe(selected.group.projectKey);
    expect(resolveSidebarProjectFilterLabel(groups, scopeKey)).toBe(selected.group.displayName);
    expect(selectedThreadKeys.size).toBe(0);

    paletteState = reduceCommandPaletteUiState(paletteState, { _tag: "SetOpen", open: false });
    expect(scopeKey).toBe(selected.group.projectKey);

    unsubscribe();
    requestSidebarProjectFilterScope(null);
    expect(scopeKey).toBe(selected.group.projectKey);
  });
});
