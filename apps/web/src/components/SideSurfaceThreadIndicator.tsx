import { PanelRightIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Identify one saved side-chat role, filling the right pane for the side-chat thread. */
function SideSurfaceThreadIndicator({ role }: { role: "owner" | "side-chat" }) {
  const label = role === "owner" ? "Has a side chat" : "Is a side chat";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className="inline-flex shrink-0 items-center text-muted-foreground/65"
          />
        }
      >
        <PanelRightIcon aria-hidden className="size-3 shrink-0">
          {role === "side-chat" ? (
            <path
              d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4Z"
              fill="currentColor"
              stroke="none"
            />
          ) : null}
        </PanelRightIcon>
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Show both roles when a thread hosts a side chat and is itself another thread's side chat. */
export function SideSurfaceThreadIndicators({
  hasSideChat,
  isSideChat,
}: {
  hasSideChat: boolean;
  isSideChat: boolean;
}) {
  return (
    <>
      {hasSideChat ? <SideSurfaceThreadIndicator role="owner" /> : null}
      {isSideChat ? <SideSurfaceThreadIndicator role="side-chat" /> : null}
    </>
  );
}
