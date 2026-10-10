import { THREAD_TAG_COLOR_PRESETS } from "@t3tools/client-runtime/thread-tag-colors";
import { ThemeColorPickerPanel } from "./settings/ThemeColorPicker";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

/** Choose a preset or a custom color without committing the tag editor's draft. */
export function ThreadTagColorPicker({
  color,
  disabled,
  onChange,
}: {
  readonly color: string | null;
  readonly disabled: boolean;
  readonly onChange: (color: string | null) => void;
}) {
  return (
    <fieldset disabled={disabled} className="grid gap-3">
      <legend className="mb-2 text-sm font-medium">Tag color</legend>
      <div className="flex flex-wrap items-center gap-2">
        {THREAD_TAG_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.color}
            type="button"
            aria-label={`${preset.label} tag color`}
            aria-pressed={color?.toLowerCase() === preset.color}
            disabled={disabled}
            onClick={() => onChange(preset.color)}
            className="size-7 shrink-0 cursor-pointer rounded-full border border-foreground/15 outline-none aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground disabled:cursor-default disabled:opacity-50"
            style={{ backgroundColor: preset.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={color === null ? "secondary" : "outline"}
          size="compact"
          aria-pressed={color === null}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Default
        </Button>
        <Popover>
          <PopoverTrigger
            render={
              <Button type="button" variant="outline" size="compact" disabled={disabled}>
                <span
                  aria-hidden
                  className="size-3.5 rounded-full border border-foreground/15"
                  style={{ backgroundColor: color ?? THREAD_TAG_COLOR_PRESETS[0].color }}
                />
                Custom color
              </Button>
            }
          />
          <PopoverPopup align="start" side="bottom" padding="none" sideOffset={8}>
            <ThemeColorPickerPanel
              label="Tag"
              value={color ?? THREAD_TAG_COLOR_PRESETS[0].color}
              onChange={onChange}
            />
          </PopoverPopup>
        </Popover>
      </div>
    </fieldset>
  );
}
