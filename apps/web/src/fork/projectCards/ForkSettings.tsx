import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { searchableSetting } from "../../components/settings/settingsSearch";
import { Switch } from "../../components/ui/switch";
import { useProjectCardsEnabled } from "./preferences";

/** Keep optional fork UI preferences separate from environment settings. */
export function ForkSettings() {
  const [projectCardsEnabled, setProjectCardsEnabled] = useProjectCardsEnabled();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Sidebar">
        <SettingsRow
          {...searchableSetting("fork-project-preview-cards")}
          description="Group active threads by project, with three previews per card. Saved on this client."
          control={
            <Switch
              checked={projectCardsEnabled}
              onCheckedChange={(checked) => setProjectCardsEnabled(Boolean(checked))}
              aria-label="Project preview cards"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
