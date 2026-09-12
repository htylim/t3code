import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { MessageSquarePlusIcon, PanelRightIcon, QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chatMarkdownClipboardPayload } from "~/markdown-clipboard";
import type {
  SelectedTextThreadAction,
  SelectedTextThreadActionHandler,
} from "~/selectedTextThreadAction";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
  onAskAboutSelection,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onAskAboutSelection?: SelectedTextThreadActionHandler;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
    selectedMarkdown: string;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom || rect.width === 0) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      setSelection({
        selectedMarkdown:
          nativeSelection && captured.selector.text.length <= ASSISTANT_CITATION_MAX_TEXT_LENGTH
            ? chatMarkdownClipboardPayload(nativeSelection)?.text.trim() || captured.selector.text
            : captured.selector.text,
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = toolbar.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!firstAction) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const ask = (action: SelectedTextThreadAction) => {
    if (tooLong || !onAskAboutSelection) return;
    window.getSelection()?.removeAllRanges();
    dismiss();
    void onAskAboutSelection(action, selection.citation, selection.selectedMarkdown);
  };
  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label="Selection actions"
      className="surface-glass fixed z-50 flex w-max max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-2xl border border-border/60 p-0.5 shadow-sm"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        className="rounded-full px-2.5"
        onClick={cite}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {tooLong ? "Shorten selection" : "Cite"}
      </Button>
      {onAskAboutSelection ? (
        <>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={tooLong}
            className="rounded-full px-2.5"
            onClick={() => ask("ask-in-new-thread")}
          >
            <MessageSquarePlusIcon aria-hidden="true" className="size-3.5" />
            Ask in new thread
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={tooLong}
            className="rounded-full px-2.5"
            onClick={() => ask("ask-in-side-chat")}
          >
            <PanelRightIcon aria-hidden="true" className="size-3.5" />
            Ask in side chat
          </Button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
