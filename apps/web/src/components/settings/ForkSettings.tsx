import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import { WorkspaceColorSettings } from "./WorkspaceColorSettings";
import { FORK_SETTINGS_AVAILABLE } from "./forkSettingsAvailability";
import { useClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

/** Edit the fork preferences saved on this device. */
export function ForkSettings() {
  const forkUiChanges = useClientSettings((settings) => settings.forkUiChanges);
  const forkGroupSidebarWorkspaces = useClientSettings(
    (settings) => settings.forkGroupSidebarWorkspaces,
  );
  const forkUseH3WorkspacePicker = useClientSettings(
    (settings) => settings.forkUseH3WorkspacePicker,
  );
  const forkUseH3Wordmark = useClientSettings((settings) => settings.forkUseH3Wordmark);

  if (!FORK_SETTINGS_AVAILABLE) return null;

  return (
    <SettingsPageContainer>
      <SettingsSection id="fork-interface" title="Interface">
        <SettingsRow
          {...searchableSetting("fork-workspace-picker")}
          description="Use named worktrees, colors, and workspace management. Turn off to use the original T3 workspace picker. Saved on this device."
          resetAction={
            forkUseH3WorkspacePicker !== DEFAULT_CLIENT_SETTINGS.forkUseH3WorkspacePicker ? (
              <SettingResetButton
                label="workspace picker"
                onClick={() =>
                  persistClientSettingsPatch({
                    forkUseH3WorkspacePicker: DEFAULT_CLIENT_SETTINGS.forkUseH3WorkspacePicker,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Enable H3 Workspace picker"
              checked={forkUseH3WorkspacePicker}
              onCheckedChange={(checked) =>
                persistClientSettingsPatch({ forkUseH3WorkspacePicker: checked })
              }
            />
          }
        />
        <SettingsRow
          {...searchableSetting("fork-ui-changes")}
          description="Enable Fork interface tweaks, including sidebar section lines. Saved on this device."
          resetAction={
            forkUiChanges !== DEFAULT_CLIENT_SETTINGS.forkUiChanges ? (
              <SettingResetButton
                label="Fork UI Changes"
                onClick={() =>
                  persistClientSettingsPatch({
                    forkUiChanges: DEFAULT_CLIENT_SETTINGS.forkUiChanges,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Fork UI Changes"
              checked={forkUiChanges}
              onCheckedChange={(checked) => persistClientSettingsPatch({ forkUiChanges: checked })}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("fork-group-sidebar-workspaces")}
          description="Combine threads in the same project and workspace into one card in the current sidebar. Applies within each section except Settled. Saved on this device."
          resetAction={
            forkGroupSidebarWorkspaces !== DEFAULT_CLIENT_SETTINGS.forkGroupSidebarWorkspaces ? (
              <SettingResetButton
                label="workspace grouping"
                onClick={() =>
                  persistClientSettingsPatch({
                    forkGroupSidebarWorkspaces: DEFAULT_CLIENT_SETTINGS.forkGroupSidebarWorkspaces,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Group threads by workspace"
              checked={forkGroupSidebarWorkspaces}
              onCheckedChange={(checked) =>
                persistClientSettingsPatch({ forkGroupSidebarWorkspaces: checked })
              }
            />
          }
        />
        <SettingsRow
          {...searchableSetting("fork-wordmark")}
          description="Show H3 Code above the sidebar. Turn off to use T3 Code. Saved on this device."
          resetAction={
            forkUseH3Wordmark !== DEFAULT_CLIENT_SETTINGS.forkUseH3Wordmark ? (
              <SettingResetButton
                label="wordmark"
                onClick={() =>
                  persistClientSettingsPatch({
                    forkUseH3Wordmark: DEFAULT_CLIENT_SETTINGS.forkUseH3Wordmark,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              aria-label="Use H3 wordmark"
              checked={forkUseH3Wordmark}
              onCheckedChange={(checked) =>
                persistClientSettingsPatch({ forkUseH3Wordmark: checked })
              }
            />
          }
        />
      </SettingsSection>
      <WorkspaceColorSettings />
    </SettingsPageContainer>
  );
}
