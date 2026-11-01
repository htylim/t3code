import { SOFT_PILL_COLOR_PRESETS } from "@t3tools/client-runtime/soft-pill-colors";
import type { WorkspaceColorMode } from "@t3tools/contracts";
import { PipetteIcon, ShuffleIcon, SparklesIcon, type LucideIcon } from "lucide-react";

import { cn } from "../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const circleClasses =
  "flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-foreground/15 bg-background text-foreground outline-none aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-inset focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset disabled:cursor-default disabled:opacity-50";

interface WorkspaceColorCircleChoice {
  label: string;
  tooltip: string;
  selected: boolean;
  onClick: (() => void) | undefined;
  Icon?: LucideIcon;
  backgroundColor?: string;
  expanded?: boolean;
}

/** Render all color choices in one evenly spaced palette with a consistent selection ring. */
export function WorkspaceColorOptions({
  color,
  colorMode,
  customOpen,
  disabled,
  label = "Worktree",
  size = "compact",
  onColorChange,
  onCustomClick,
  onModeChange,
}: {
  color: string;
  colorMode?: WorkspaceColorMode | undefined;
  customOpen: boolean;
  disabled: boolean;
  label?: string;
  size?: "compact" | "default";
  onColorChange: (color: string) => void;
  onCustomClick?: (() => void) | undefined;
  onModeChange?: ((mode: WorkspaceColorMode) => void) | undefined;
}) {
  const presetSelected = SOFT_PILL_COLOR_PRESETS.some(
    (preset) => preset.color === color.toLowerCase(),
  );
  const circleSize = size === "compact" ? "size-5" : "size-7";
  const iconSize = size === "compact" ? "size-2.5" : "size-3.5";
  const choices: WorkspaceColorCircleChoice[] = [
    {
      label: "Random",
      tooltip: "Random",
      Icon: ShuffleIcon,
      selected: !customOpen && colorMode === "random",
      onClick: onModeChange ? () => onModeChange("random") : undefined,
    },
    {
      label: "Auto",
      tooltip: "Auto",
      Icon: SparklesIcon,
      selected: !customOpen && colorMode === "auto",
      onClick: onModeChange ? () => onModeChange("auto") : undefined,
    },
    ...SOFT_PILL_COLOR_PRESETS.map((preset) => ({
      label: `${preset.label} ${label.toLowerCase()} color`,
      tooltip: preset.label,
      backgroundColor: preset.color,
      selected: !customOpen && !colorMode && color.toLowerCase() === preset.color,
      onClick: () => onColorChange(preset.color),
    })),
    {
      label: "Custom color",
      tooltip: "Custom color",
      Icon: PipetteIcon,
      selected: customOpen || (!colorMode && !presetSelected),
      expanded: customOpen,
      onClick: onCustomClick,
    },
  ];

  return (
    <div className="flex items-center gap-2 p-0.5">
      {choices.map((choice) => {
        if (!choice.onClick) return null;
        const Icon = choice.Icon;
        return (
          <Tooltip key={choice.label}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={choice.label}
                  aria-pressed={choice.selected}
                  aria-expanded={choice.expanded}
                  disabled={disabled}
                  onClick={choice.onClick}
                  className={cn(circleClasses, circleSize)}
                  style={
                    choice.backgroundColor ? { backgroundColor: choice.backgroundColor } : undefined
                  }
                />
              }
            >
              {Icon ? <Icon aria-hidden className={iconSize} /> : null}
            </TooltipTrigger>
            <TooltipPopup>{choice.tooltip}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
