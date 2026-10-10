import { cn } from "../lib/utils";

/** Render a tag pill. Editable pills open on double-click or keyboard activation. */
export function ThreadTagPill({
  label,
  color,
  className,
  onEdit,
}: {
  readonly label: string;
  readonly color?: string | null;
  readonly className?: string;
  readonly onEdit?: (() => void) | undefined;
}) {
  const pillClassName = cn(
    "inline-block max-w-full truncate rounded-full border border-foreground/10 bg-foreground/5 px-2 align-middle text-xs leading-4",
    className,
    onEdit &&
      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  );
  const pillStyle = color
    ? {
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
        color: `color-mix(in srgb, ${color} 65%, var(--foreground))`,
      }
    : undefined;
  if (onEdit) {
    return (
      <button
        type="button"
        aria-label={`Edit tag ${label}`}
        className={pillClassName}
        style={pillStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          // Native keyboard activation has no pointer click count.
          if (event.detail === 0) onEdit();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onEdit();
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={pillClassName} style={pillStyle}>
      {label}
    </span>
  );
}
