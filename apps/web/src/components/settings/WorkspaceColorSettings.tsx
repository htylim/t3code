import {
  WORKSPACE_COLOR_PRESETS,
  type ClientSettingsPatch,
  type WorkspaceColorRule,
} from "@t3tools/contracts";
import { usePrimaryEnvironment } from "../../state/environments";
import { randomUUID } from "../../lib/utils";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  useClientSettings,
  persistClientSettingsPatch,
  usePrimarySettings,
  useUpdatePrimarySettings,
  usePrimarySettingsAvailable,
} from "../../hooks/useSettings";
import { WorktreeColorPicker } from "../WorktreeColorPicker";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Configure workspace colors for this server, including unattended launches. */
export function WorkspaceColorSettings() {
  const legacy = useClientSettings((settings) => settings);
  const preferences = usePrimarySettings((settings) => settings.forkWorkspaceColors);
  const updateSettings = useUpdatePrimarySettings();
  const available = usePrimarySettingsAvailable();
  const supportsServerColors =
    usePrimaryEnvironment()?.serverConfig?.environment.capabilities.fork?.worktrees
      ?.workspaceColors === true;
  const { choice, fallbackColor, rules } = preferences ?? {
    choice: legacy.forkDefaultWorkspaceColor,
    fallbackColor: legacy.forkWorkspaceFallbackColor,
    rules: legacy.forkColorPickerPrompts,
  };
  /** Save environment rules, retaining device settings only for older servers. */
  function persistColorSettings(patch: ClientSettingsPatch) {
    if (!supportsServerColors) {
      void persistClientSettingsPatch(patch);
      return;
    }
    updateSettings({
      forkWorkspaceColors: {
        choice: patch.forkDefaultWorkspaceColor ?? choice,
        fallbackColor: patch.forkWorkspaceFallbackColor ?? fallbackColor,
        rules: patch.forkColorPickerPrompts ?? rules,
      },
    });
  }
  const mode = choice === "auto" || choice === "random" ? choice : undefined;

  /** Persist one rule while preserving the other color prompts. */
  function updateRule(id: string, patch: Partial<WorkspaceColorRule>) {
    persistColorSettings({
      forkColorPickerPrompts: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  }

  return (
    <SettingsSection id="fork-workspace-colors" title="Workspace colors">
      <SettingsRow
        {...searchableSetting("fork-default-workspace-color")}
        description="Preselected for new workspaces. You can change it in the workspace picker. Saved on this server. Auto also applies to scheduled launches."
        control={
          <WorktreeColorPicker
            ariaLabel="Default Workspace Color"
            color={mode ? WORKSPACE_COLOR_PRESETS[0].color : choice}
            colorMode={mode}
            disabled={!available}
            showLabel
            onChange={(color, colorMode) => {
              persistColorSettings({ forkDefaultWorkspaceColor: colorMode ?? color });
            }}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("fork-workspace-fallback-color")}
        description="Used by Auto when no color prompt matches or color selection is unavailable. Saved on this server. Auto also applies to scheduled launches."
        control={
          <WorktreeColorPicker
            ariaLabel="Fallback color"
            color={fallbackColor}
            disabled={!available}
            allowModes={false}
            showLabel
            onChange={(color) => {
              persistColorSettings({ forkWorkspaceFallbackColor: color });
            }}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("fork-color-picker-prompts")}
        description="When Auto is selected, choose a color using the first prompt and project context. The most specific match wins; ties use the first rule. No match uses the fallback color."
      >
        <div className="mt-3 flex max-w-2xl flex-col gap-3 pb-3.5">
          {rules.map((rule, index) => (
            <div key={rule.id} className="grid gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <WorktreeColorPicker
                  ariaLabel={`Color for prompt ${index + 1}`}
                  color={rule.color}
                  disabled={!available}
                  allowModes={false}
                  showLabel
                  onChange={(color) => updateRule(rule.id, { color })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete color prompt ${index + 1}`}
                  onClick={() =>
                    persistColorSettings({
                      forkColorPickerPrompts: rules.filter((candidate) => candidate.id !== rule.id),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Textarea
                aria-label={`Color prompt ${index + 1}`}
                rows={3}
                maxLength={4000}
                defaultValue={rule.prompt}
                placeholder="For example: Code reviews and pull request reviews"
                onBlur={(event) => {
                  if (event.target.value !== rule.prompt)
                    updateRule(rule.id, { prompt: event.target.value });
                }}
              />
            </div>
          ))}
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a color and describe when Auto should choose it.
            </p>
          ) : null}
          <div>
            <Button
              variant="outline"
              size="compact"
              disabled={!available || rules.length >= 100}
              onClick={() =>
                persistColorSettings({
                  forkColorPickerPrompts: [
                    ...rules,
                    { id: randomUUID(), color: "#f43f5e", prompt: "" },
                  ],
                })
              }
            >
              <PlusIcon />
              Add prompt
            </Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
