import { useEffect, useState } from "react";
import { SOFT_PILL_COLOR_PRESETS } from "@t3tools/client-runtime/soft-pill-colors";
import type { WorkspaceColorMode } from "@t3tools/contracts";
import { createWorkspaceColorSelection } from "../workspaceColorSelection";
import { WorkspaceColorOptions } from "./WorkspaceColorOptions";
import { SparklesIcon, ShuffleIcon, ChevronDownIcon } from "lucide-react";

import { useComposerMenuProps } from "./chat/composerEventScope";
import { createFrameCommitter, ThemeColorPickerPanel } from "./settings/ThemeColorPicker";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

/** Choose a worktree color while keeping the workspace menu open. */
export function WorktreeColorPicker({
  color,
  ariaLabel = "Worktree color",
  colorMode,
  allowModes = true,
  allowCustom = true,
  showLabel = false,
  disabled,
  onChange,
  onOpen,
}: {
  ariaLabel?: string;
  allowModes?: boolean;
  allowCustom?: boolean;
  showLabel?: boolean;
  color: string;
  colorMode?: WorkspaceColorMode | undefined;
  disabled: boolean;
  onChange: (color: string, colorMode?: WorkspaceColorMode) => void;
  onOpen?: () => void;
}) {
  const [committer] = useState(createFrameCommitter);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- commits the last custom color when its picker unmounts
  useEffect(() => committer.flush, [committer]);
  const floatingLayerProps = useComposerMenuProps();
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const ModeIcon = colorMode === "auto" ? SparklesIcon : ShuffleIcon;
  const presetLabel =
    SOFT_PILL_COLOR_PRESETS.find((preset) => preset.color === color)?.label ?? "Custom";
  const modeLabel = colorMode === "auto" ? "Auto" : "Random";
  /** Commit a discrete choice and close the color popover. */
  function chooseColor(nextColor: string, nextMode?: WorkspaceColorMode) {
    committer.flush();
    onChange(nextColor, nextMode);
    setCustom(false);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) committer.flush();
        setOpen(nextOpen);
        if (nextOpen) onOpen?.();
      }}
    >
      <PopoverTrigger
        render={<Button variant="ghost" size="compact" disabled={disabled} />}
        aria-label={ariaLabel}
      >
        {colorMode ? (
          <ModeIcon className="size-3" />
        ) : (
          <span
            aria-hidden
            className="size-3 rounded-full border border-foreground/15"
            style={{ backgroundColor: color }}
          />
        )}
        {showLabel ? <span>{colorMode ? modeLabel : presetLabel}</span> : null}
        <ChevronDownIcon className="size-3" />
      </PopoverTrigger>
      {/* Reposition on expansion so the compact popup's height limit cannot clip the editor. */}
      <PopoverPopup
        align="end"
        side={custom ? "bottom" : "top"}
        padding="compact"
        {...floatingLayerProps}
      >
        <div
          className="grid w-max gap-2"
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        >
          <WorkspaceColorOptions
            color={color}
            colorMode={colorMode}
            customOpen={custom}
            disabled={disabled}
            onColorChange={chooseColor}
            onModeChange={
              allowModes
                ? (mode) => {
                    const selection = createWorkspaceColorSelection(mode);
                    chooseColor(selection.color, selection.colorMode);
                  }
                : undefined
            }
            onCustomClick={
              allowCustom
                ? () => {
                    committer.flush();
                    onChange(color);
                    setCustom(!custom);
                  }
                : undefined
            }
          />
          {custom ? (
            <ThemeColorPickerPanel
              width="full"
              committer={committer}
              label="Worktree"
              value={color}
              onChange={(customColor) => onChange(customColor)}
            />
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
