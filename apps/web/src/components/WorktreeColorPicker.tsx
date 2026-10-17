import { THREAD_TAG_COLOR_PRESETS } from "@t3tools/client-runtime/thread-tag-colors";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useComposerMenuProps } from "./chat/composerEventScope";
import { ThemeColorPickerPanel } from "./settings/ThemeColorPicker";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

/** Select a worktree color without selecting or closing the workspace row. */
export function WorktreeColorPicker({
  color,
  disabled,
  onChange,
}: {
  color: string;
  disabled: boolean;
  onChange: (color: string) => void;
}) {
  const floatingLayerProps = useComposerMenuProps();
  const [custom, setCustom] = useState(false);
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="compact" disabled={disabled} />}
        aria-label="Worktree color"
      >
        <span
          aria-hidden
          className="size-3 rounded-full border border-foreground/15"
          style={{ backgroundColor: color }}
        />
        <ChevronDownIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup align="end" side="top" padding="compact" {...floatingLayerProps}>
        <div
          className="grid gap-2"
          onKeyDown={(event) => {
            if (event.key !== "Escape") event.stopPropagation();
          }}
        >
          <div className="flex items-center gap-2">
            {THREAD_TAG_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.color}
                type="button"
                aria-label={`${preset.label} worktree color`}
                aria-pressed={color.toLowerCase() === preset.color}
                onClick={() => onChange(preset.color)}
                className="size-5 cursor-pointer rounded-full border border-foreground/15 outline-none aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
                style={{ backgroundColor: preset.color }}
              />
            ))}
          </div>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => setCustom(!custom)}
            aria-expanded={custom}
          >
            Custom color
          </Button>
          {custom ? (
            <ThemeColorPickerPanel label="Worktree" value={color} onChange={onChange} />
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
