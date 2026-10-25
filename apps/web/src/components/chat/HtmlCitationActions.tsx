import type { AssistantCitation, AssistantCitationSource } from "@t3tools/contracts";
import { readHtmlCitationMessage } from "@t3tools/shared/htmlRenderCitation";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { isSelectionRectVisible, resolveSelectionActionPosition } from "~/lib/selectionActions";
import type { SelectedTextThreadActionHandler } from "~/selectedTextThreadAction";
import type { AssistantCitationTarget } from "./AssistantCitationSource";
import {
  AssistantSelectionToolbar,
  type AssistantToolbarSelection,
} from "./AssistantSelectionToolbar";

export interface HtmlCitationContext {
  source: Extract<AssistantCitationSource, { kind: "html-attachment" }>;
  onCite: (citation: AssistantCitation, anchor?: AssistantCitationSourceAnchor) => boolean;
  onAskAboutSelection?: SelectedTextThreadActionHandler | undefined;
  request?: AssistantCitationTarget | null | undefined;
  onReveal?: ((rect: DOMRect, found: boolean) => void) | undefined;
}

/** Keeps trusted citation controls outside the sandbox and binds frame data to its actual attachment. */
export function HtmlCitationActions({
  frameRef,
  loaded,
  context,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  loaded: boolean;
  context: HtmlCitationContext;
}) {
  const [captured, setCaptured] = useState<{
    selection: AssistantToolbarSelection;
    viewport: HTMLElement;
    portalContainer: HTMLElement;
  } | null>(null);
  const requestedKey = useRef<string | null>(null);
  const requestKey = context.request?.key;

  /** Sends quote operations only to this mounted iframe, never a URL or another environment. */
  const command = (action: string, citation?: AssistantCitation, requestId?: string) => {
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "t3-html-citation-command",
        action,
        selector: citation,
        requestId,
      },
      "*",
    );
  };
  const reveal = useEffectEvent(() => {
    const request = context.request;
    if (!request || request.activationRef.current.dismissed || requestedKey.current === request.key)
      return;
    requestedKey.current = request.key;
    command("reveal", request.citation, request.key);
  });
  useEffect(() => {
    if (loaded && requestKey) reveal();
  }, [loaded, requestKey]);

  const receive = useEffectEvent((event: MessageEvent) => {
    const frame = frameRef.current;
    if (!frame || event.source !== frame.contentWindow) return;
    const message = readHtmlCitationMessage(event.data);
    if (!message) return;
    if (message.action === "ready") {
      reveal();
      return;
    }
    const bounds = message.rect;
    /** Recomputes the frame position when scrolling moves a source-anchored comment popup. */
    const quoteRect = () => {
      const frameRect = frame.getBoundingClientRect();
      if (!bounds) return frameRect;
      const scaleX = frameRect.width / (message.width || frame.clientWidth || 1);
      const scaleY = frameRect.height / (message.height || frame.clientHeight || 1);
      return new DOMRect(
        frameRect.left + bounds.left * scaleX,
        frameRect.top + bounds.top * scaleY,
        (bounds.right - bounds.left) * scaleX,
        (bounds.bottom - bounds.top) * scaleY,
      );
    };
    const rect = quoteRect();
    if (message.action === "revealed") {
      if (
        context.request &&
        message.requestId === context.request.key &&
        !context.request.activationRef.current.dismissed
      ) {
        context.onReveal?.(rect, bounds !== undefined);
      }
      return;
    }
    if (message.action === "dismiss") {
      setCaptured(null);
      return;
    }
    if (message.action === "focus") {
      captured?.portalContainer
        .querySelector<HTMLButtonElement>('[aria-label="Selection actions"] button:not(:disabled)')
        ?.focus();
      return;
    }
    if (document.activeElement !== frame || !message.selector || !bounds) return;
    const viewport =
      frame.closest<HTMLElement>("[data-assistant-citation-viewport]") ?? frame.parentElement;
    if (
      !viewport ||
      !isSelectionRectVisible(rect, [
        frame.getBoundingClientRect(),
        viewport.getBoundingClientRect(),
      ])
    ) {
      setCaptured(null);
      return;
    }
    const citation: AssistantCitation = { version: 2, source: context.source, ...message.selector };
    window.getSelection()?.removeAllRanges();
    const anchor: AssistantCitationSourceAnchor = {
      kind: "html",
      source: frame,
      viewport,
      getBoundingClientRect: quoteRect,
      highlight: (quote) => {
        frame.contentWindow?.postMessage(
          { type: "t3-html-citation-command", action: "highlight", selector: quote },
          "*",
        );
        return () =>
          frame.contentWindow?.postMessage(
            { type: "t3-html-citation-command", action: "clear-highlight" },
            "*",
          );
      },
    };
    setCaptured({
      viewport,
      portalContainer: frame.closest<HTMLElement>('[role="dialog"]') ?? document.body,
      selection: {
        citation,
        sourceAnchor: anchor,
        selectedMarkdown: citation.text,
        position: resolveSelectionActionPosition({
          bounds: viewport.getBoundingClientRect(),
          selectionRect: rect,
          pointer: null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      },
    });
  });
  useEffect(() => {
    window.addEventListener("message", receive);
    const dismiss = () => setCaptured(null);
    const onPointerDown = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('[aria-label="Selection actions"]')
      )
        dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("message", receive);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  return (
    <AssistantSelectionToolbar
      viewport={captured?.viewport ?? null}
      threadRef={context.source}
      onCite={context.onCite}
      {...(context.onAskAboutSelection ? { onAskAboutSelection: context.onAskAboutSelection } : {})}
      externalSelection={captured?.selection ?? null}
      onDismissExternal={() => setCaptured(null)}
      onClearExternal={() => command("clear-selection")}
      {...(captured ? { portalContainer: captured.portalContainer } : {})}
    />
  );
}
