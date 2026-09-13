import { PanelRightIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function SideSurfaceThreadIndicator() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Visible in side surface"
            className="inline-flex shrink-0 items-center text-muted-foreground/65"
          />
        }
      >
        <PanelRightIcon aria-hidden className="size-3 shrink-0" />
      </TooltipTrigger>
      <TooltipPopup>Visible in side surface</TooltipPopup>
    </Tooltip>
  );
}
