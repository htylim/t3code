import type { ProviderInstanceConfig, ProviderInstanceId } from "@t3tools/contracts";
import {
  isForkUsageDashboardIncluded,
  supportsForkUsageDashboardToggle,
  withForkUsageDashboardIncluded,
} from "@t3tools/shared/forkUsageDashboard";

import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

/** Fork-only account preference saved through the existing provider settings mutation. */
export function ForkUsageDashboardSetting({
  instanceId,
  instance,
  readOnly,
  onUpdate,
}: {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly readOnly: boolean;
  readonly onUpdate: (instance: ProviderInstanceConfig) => void;
}) {
  if (!supportsForkUsageDashboardToggle(instance.driver)) return null;

  /** The server settings stream refreshes usage summaries after this preference changes. */
  const updateIncluded = (included: boolean) => {
    onUpdate(withForkUsageDashboardIncluded(instance, included));
  };

  return (
    <SettingsRow
      id={`provider-instance-${instanceId}-usage-dashboard`}
      title="Include in usage dashboard"
      description="Include this account's history in Cost and Tokens. Limits are unchanged. Accounts sharing a history directory count together."
      control={
        <Switch
          aria-label="Include in usage dashboard"
          checked={isForkUsageDashboardIncluded(instance)}
          disabled={readOnly}
          onCheckedChange={updateIncluded}
        />
      }
    />
  );
}
