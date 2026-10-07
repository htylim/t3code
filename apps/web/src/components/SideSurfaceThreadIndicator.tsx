import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PanelRightIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useRightPanelStore } from "../rightPanelStore";

import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Identify one saved side-chat role, filling the right pane for the side-chat thread. */
function SideSurfaceThreadIndicator({
  role,
  onOpenParent,
}: {
  role: "owner" | "side-chat";
  onOpenParent?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = role === "owner" ? "Has a side chat" : "In a side chat";

  /** Keep Enter and Space on the icon from activating the enclosing thread row. */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  }

  let indicatorTrigger;
  if (role === "side-chat") {
    indicatorTrigger = (
      <button
        type="button"
        aria-label={label}
        className="-m-1 inline-flex shrink-0 cursor-pointer items-center rounded p-1 text-muted-foreground/65 outline-hidden hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onOpenParent}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    );
  } else {
    indicatorTrigger = (
      <span
        role="img"
        aria-label={label}
        className="inline-flex shrink-0 items-center text-muted-foreground/65"
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={indicatorTrigger}>
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

/** Show saved side-chat roles and let side chats return to their owning thread. */
export function SideSurfaceThreadIndicators({
  hasSideChat,
  isSideChat,
  threadRef,
  onNavigateToThread,
}: {
  hasSideChat: boolean;
  isSideChat: boolean;
  threadRef: ScopedThreadRef;
  onNavigateToThread: (threadRef: ScopedThreadRef) => void;
}) {
  /** Reveal the first saved parent's existing chat tab, preserving transient chat metadata. */
  function handleOpenParent(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const panelStore = useRightPanelStore.getState();
    const targetThreadKey = scopedThreadKey(threadRef);
    for (const [ownerThreadKey, panelState] of Object.entries(panelStore.byThreadKey)) {
      const chatSurface = panelState.surfaces.find(
        (surface) => surface.kind === "chat" && scopedThreadKey(surface) === targetThreadKey,
      );
      if (!chatSurface) continue;
      const ownerThreadRef = parseScopedThreadKey(ownerThreadKey);
      if (!ownerThreadRef) continue;
      panelStore.activateSurface(ownerThreadRef, chatSurface.id);
      onNavigateToThread(ownerThreadRef);
      return;
    }
  }

  return (
    <>
      {hasSideChat ? <SideSurfaceThreadIndicator role="owner" /> : null}
      {isSideChat ? (
        <SideSurfaceThreadIndicator role="side-chat" onOpenParent={handleOpenParent} />
      ) : null}
    </>
  );
}
