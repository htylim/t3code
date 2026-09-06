import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_RUNTIME_MODE, type ModelSelection, type RuntimeMode } from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import { getProviderModelCapabilities } from "../../providerModels";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const PERMISSION_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

/** Configure the provider, model options, and permission mode for fresh chats. */
export function ForkSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const defaults = settings.newChatDefaults;
  const selection =
    defaults?.modelSelection ?? resolveDefaultProviderModelSelection(providers, null);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const selectedEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );

  /** Save a complete selection, including the options displayed by the model picker. */
  function saveSelection(nextSelection: ModelSelection) {
    const entry = entries.find((candidate) => candidate.instanceId === nextSelection.instanceId);
    if (!entry) return;
    const descriptors = getProviderOptionDescriptors({
      caps: getProviderModelCapabilities(
        entry.models,
        nextSelection.model,
        entry.driverKind,
        settings.planModeEnabled,
      ),
      selections: nextSelection.options,
    });
    const modelOptionsForDispatch = buildProviderOptionSelectionsFromDescriptors(descriptors);
    updateSettings({
      newChatDefaults: {
        modelSelection: createModelSelection(
          nextSelection.instanceId,
          nextSelection.model,
          modelOptionsForDispatch,
        ),
        runtimeMode: defaults?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
      },
    });
  }

  return (
    <SettingsSection id="fork" title="Fork">
      <SettingsRow
        serverScoped
        {...searchableSetting("new-chat-defaults")}
        description="Start new chats with these choices instead of project pins or the previous chat. Existing chats keep their settings."
        resetAction={
          defaults ? (
            <SettingResetButton
              label="new chat defaults"
              onClick={() => updateSettings({ newChatDefaults: null })}
            />
          ) : null
        }
        control={
          <Switch
            checked={defaults !== null}
            disabled={!selection && !defaults}
            aria-label="Use new chat defaults"
            onCheckedChange={(enabled) => {
              if (enabled && selection) saveSelection(selection);
              else updateSettings({ newChatDefaults: null });
            }}
          />
        }
      />
      {defaults && selection ? (
        <>
          <SettingsRow
            serverScoped
            title="Provider, model & effort"
            description="Choose an account and model, then set its supported reasoning options."
            control={
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  activeInstanceId={selection.instanceId}
                  model={selection.model}
                  lockedProvider={null}
                  instanceEntries={entries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  triggerVariant="outline"
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onInstanceModelChange={(instanceId, model) =>
                    saveSelection(createModelSelection(instanceId, model))
                  }
                />
                {selectedEntry ? (
                  <TraitsPicker
                    provider={selectedEntry.driverKind}
                    models={selectedEntry.models}
                    model={selection.model}
                    modelOptions={selection.options}
                    prompt=""
                    onPromptChange={() => {}}
                    allowPromptInjectedEffort={false}
                    planModeEnabled={settings.planModeEnabled}
                    triggerVariant="outline"
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(options) =>
                      saveSelection(
                        createModelSelection(selection.instanceId, selection.model, options),
                      )
                    }
                  />
                ) : null}
              </div>
            }
          />
          <SettingsRow
            serverScoped
            title="Permission"
            description="Controls when the agent asks before running commands or changing files."
            control={
              <Select
                value={defaults.runtimeMode}
                onValueChange={(runtimeMode) => {
                  if (
                    runtimeMode === "approval-required" ||
                    runtimeMode === "auto-accept-edits" ||
                    runtimeMode === "auto" ||
                    runtimeMode === "full-access"
                  ) {
                    updateSettings({ newChatDefaults: { ...defaults, runtimeMode } });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-44"
                  aria-label="New chat permission"
                >
                  <SelectValue>{PERMISSION_LABELS[defaults.runtimeMode]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(PERMISSION_LABELS).map(([runtimeMode, label]) => (
                    <SelectItem key={runtimeMode} hideIndicator value={runtimeMode}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
