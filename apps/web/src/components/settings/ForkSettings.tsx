import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import { APP_STAGE_LABEL } from "../../branding";
import { useClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

/** Edit this device's fork branding without changing the desktop app's identity. */
export function ForkSettings() {
  const forkUseH3Wordmark = useClientSettings((settings) => settings.forkUseH3Wordmark);

  if (APP_STAGE_LABEL !== "Fork") return null;

  return (
    <SettingsPageContainer>
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
