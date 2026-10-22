import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "~/lib/utils";

type SoftPillProps = Omit<useRender.ComponentProps<"span">, "color"> & {
  color?: string | null | undefined;
};

/** Render a compact label with a soft background derived from its optional color. */
export function SoftPill({ color, className, render, ...props }: SoftPillProps) {
  const defaultProps = {
    "data-slot": "soft-pill",
    className: cn(
      "inline-block max-w-full truncate rounded-full border border-foreground/10 bg-foreground/5 px-2 align-middle text-xs leading-4 [button&]:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-50",
      className,
    ),
    style: color
      ? {
          backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
          color: `color-mix(in srgb, ${color} 65%, var(--foreground))`,
        }
      : undefined,
  };
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(defaultProps, props),
  });
}
