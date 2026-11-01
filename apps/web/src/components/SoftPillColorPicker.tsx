import type { WorkspaceColorMode } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { DEFAULT_SOFT_PILL_COLOR } from "@t3tools/client-runtime/soft-pill-colors";

import { createWorkspaceColorSelection } from "../workspaceColorSelection";
import { WorkspaceColorOptions } from "./WorkspaceColorOptions";
import { createFrameCommitter, ThemeColorPickerPanel } from "./settings/ThemeColorPicker";

/** Choose a preset, a mode, or a custom color without saving the enclosing dialog. */
export function SoftPillColorPicker({
  color,
  colorMode,
  onModeChange,
  label,
  disabled,
  onChange,
}: {
  readonly color: string | null;
  readonly colorMode?: WorkspaceColorMode | undefined;
  readonly onModeChange?: (color: string, mode: WorkspaceColorMode) => void;
  readonly label: string;
  readonly disabled: boolean;
  readonly onChange: (color: string | null) => void;
}) {
  const [committer] = useState(createFrameCommitter);
  const [customOpen, setCustomOpen] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- commits the last custom color when its picker unmounts
  useEffect(() => committer.flush, [committer]);
  return (
    <fieldset disabled={disabled} className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">{label} color</legend>
      <WorkspaceColorOptions
        label={label}
        color={color ?? DEFAULT_SOFT_PILL_COLOR}
        colorMode={colorMode}
        customOpen={customOpen}
        disabled={disabled}
        size="default"
        onColorChange={(nextColor) => {
          committer.flush();
          setCustomOpen(false);
          onChange(nextColor);
        }}
        onModeChange={
          onModeChange
            ? (mode) => {
                committer.flush();
                setCustomOpen(false);
                onModeChange(createWorkspaceColorSelection(mode).color, mode);
              }
            : undefined
        }
        onCustomClick={() => {
          committer.flush();
          onChange(color ?? DEFAULT_SOFT_PILL_COLOR);
          setCustomOpen(!customOpen);
        }}
      />
      {customOpen ? (
        <ThemeColorPickerPanel
          width="full"
          committer={committer}
          label={label}
          value={color ?? DEFAULT_SOFT_PILL_COLOR}
          onChange={onChange}
        />
      ) : null}
    </fieldset>
  );
}
