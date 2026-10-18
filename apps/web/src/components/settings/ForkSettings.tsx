import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

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
  const forkGroupSidebarWorkspaces = useClientSettings(
    (settings) => settings.forkGroupSidebarWorkspaces,
  );
  const forkUseH3Wordmark = useClientSettings((settings) => settings.forkUseH3Wordmark);

  if (!FORK_SETTINGS_AVAILABLE) return null;

  return (
    <SettingsPageContainer>
      <SettingsSection id="fork-sidebar" title="Sidebar">
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
      </SettingsSection>
      <SettingsSection id="fork-branding" title="Branding">
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
    </SettingsPageContainer>
  );
}
