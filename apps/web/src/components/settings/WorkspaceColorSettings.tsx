import { WORKSPACE_COLOR_PRESETS, type WorkspaceColorRule } from "@t3tools/contracts";
import { randomUUID } from "../../lib/utils";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { WorktreeColorPicker } from "../WorktreeColorPicker";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Configure the initial workspace color and the rules used by Auto on this device. */
export function WorkspaceColorSettings() {
  const choice = useClientSettings((settings) => settings.forkDefaultWorkspaceColor);
  const fallbackColor = useClientSettings((settings) => settings.forkWorkspaceFallbackColor);
  const rules = useClientSettings((settings) => settings.forkColorPickerPrompts);
  const mode = choice === "auto" || choice === "random" ? choice : undefined;

  /** Persist one rule while preserving the other color prompts. */
  function updateRule(id: string, patch: Partial<WorkspaceColorRule>) {
    persistClientSettingsPatch({
      forkColorPickerPrompts: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  }

  return (
    <SettingsSection id="fork-workspace-colors" title="Workspace colors">
      <SettingsRow
        {...searchableSetting("fork-default-workspace-color")}
        description="Preselected for new workspaces. You can change it in the workspace picker. Saved on this device."
        control={
          <WorktreeColorPicker
            ariaLabel="Default Workspace Color"
            color={mode ? WORKSPACE_COLOR_PRESETS[0].color : choice}
            colorMode={mode}
            disabled={false}
            showLabel
            onChange={(color, colorMode) => {
              persistClientSettingsPatch({ forkDefaultWorkspaceColor: colorMode ?? color });
            }}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("fork-workspace-fallback-color")}
        description="Used by Auto when no color prompt matches or color selection is unavailable. Saved on this device."
        control={
          <WorktreeColorPicker
            ariaLabel="Fallback color"
            color={fallbackColor}
            disabled={false}
            allowModes={false}
            showLabel
            onChange={(color) => {
              persistClientSettingsPatch({ forkWorkspaceFallbackColor: color });
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
                  disabled={false}
                  allowModes={false}
                  showLabel
                  onChange={(color) => updateRule(rule.id, { color })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete color prompt ${index + 1}`}
                  onClick={() =>
                    persistClientSettingsPatch({
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
              disabled={rules.length >= 100}
              onClick={() =>
                persistClientSettingsPatch({
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
