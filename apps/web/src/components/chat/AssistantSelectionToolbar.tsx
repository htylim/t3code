import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { MessageSquarePlusIcon, PanelRightIcon, QuoteIcon } from "lucide-react";
import { use, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import { BackgroundThreadContext } from "./backgroundThread";
import { withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { Popover, PopoverPopup } from "../ui/popover";
import { AssistantCitationCommentEditor } from "./AssistantCitationCommentEditor";
import { resolveAssistantCitationCommentDismissal } from "./assistantCitationCommentDismissal";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  createAssistantCitationCommentAnchor,
  observeAssistantCitationCommentSource,
} from "./AssistantCitationSource";

export type AssistantToolbarSelection = {
  citation: AssistantCitation;
  position: SelectionActionPoint;
  sourceAnchor: AssistantCitationSourceAnchor;
  selectedMarkdown: string;
};

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
  onAskAboutSelection,
  externalSelection,
  onDismissExternal,
  onClearExternal,
  portalContainer,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onAskAboutSelection?: SelectedTextThreadActionHandler;
  externalSelection?: AssistantToolbarSelection | null;
  onDismissExternal?: () => void;
  onClearExternal?: () => void;
  portalContainer?: HTMLElement;
}) {
  const [nativeSelection, setSelection] = useState<AssistantToolbarSelection | null>(null);
  const [sideChatComment, setSideChatComment] = useState<{
    selection: AssistantToolbarSelection;
    portalContainer: HTMLElement;
  } | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const draftCommentRef = useRef<string | null>(null);
  const selection = externalSelection === undefined ? nativeSelection : externalSelection;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);
  const backgroundThread = use(BackgroundThreadContext);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- highlights the selected source while its comment popup is open and closes it if the source disappears
  useEffect(() => {
    if (!sideChatComment) return;
    return observeAssistantCitationCommentSource({
      anchor: sideChatComment.selection.sourceAnchor,
      citation: sideChatComment.selection.citation,
      onUnavailable: () => setSideChatComment(null),
    });
  }, [sideChatComment]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the toolbar DOM node and clamps its position inside the window before paint
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to document selectionchange and keydown to track text selections in the viewport
  useEffect(() => {
    if (!viewport || externalSelection !== undefined) return;
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
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        selectedMarkdown:
          nativeSelection && captured.selector.text.length <= ASSISTANT_CITATION_MAX_TEXT_LENGTH
            ? chatMarkdownClipboardPayload(nativeSelection)?.text.trim() || captured.selector.text
            : captured.selector.text,
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 2,
          source: { kind: "assistant-message", ...threadRef, messageId: MessageId.make(messageId) },
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
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
    // Tab belongs to the foreground chat; a background timeline only follows its selection.
    if (!backgroundThread) document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [backgroundThread, externalSelection, threadRef, viewport]);

  const dismiss = () => {
    actionsRef.current?.cancel();
    onDismissExternal?.();
    setSelection(null);
  };
  if (sideChatComment) {
    const captured = sideChatComment.selection;
    /** Open the unsent side chat only after the citation comment is saved. */
    const saveComment = (comment: string) => {
      if (!onAskAboutSelection) return false;
      setSideChatComment(null);
      dismiss();
      void onAskAboutSelection(
        "ask-in-side-chat",
        withAssistantCitationComment(captured.citation, comment),
        captured.selectedMarkdown,
      );
      return true;
    };
    return createPortal(
      <Popover
        open
        onOpenChange={(open, details) => {
          if (open) return;
          const dismissal = resolveAssistantCitationCommentDismissal({
            reason: details.reason,
            draft: draftCommentRef.current,
            savedComment: captured.citation.comment,
          });
          if (dismissal.kind === "keep-open") {
            details.cancel();
            return;
          }
          if (dismissal.kind === "commit") saveComment(dismissal.comment);
          else setSideChatComment(null);
        }}
      >
        <PopoverPopup
          {...composerFloatingLayerProps}
          aria-label="Edit citation comment"
          width="md"
          padding="compact"
          side="bottom"
          align="end"
          anchor={createAssistantCitationCommentAnchor(captured.sourceAnchor)}
          initialFocus={() => {
            commentInputRef.current?.focus({ preventScroll: true });
            return false;
          }}
          finalFocus={false}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <AssistantCitationCommentEditor
            citation={captured.citation}
            inputRef={commentInputRef}
            onSubmit={saveComment}
            onDraftChange={(comment) => {
              draftCommentRef.current = comment;
            }}
            onCancel={() => setSideChatComment(null)}
          />
        </PopoverPopup>
      </Popover>,
      sideChatComment.portalContainer,
    );
  }
  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const cite = () => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    if (onClearExternal) onClearExternal();
    else window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const ask = (action: SelectedTextThreadAction) => {
    if (tooLong || !onAskAboutSelection) return;
    if (action === "ask-in-side-chat") {
      draftCommentRef.current = null;
      setSideChatComment({ selection, portalContainer: portalContainer ?? document.body });
    }
    if (onClearExternal) onClearExternal();
    else window.getSelection()?.removeAllRanges();
    dismiss();
    if (action !== "ask-in-side-chat") {
      void onAskAboutSelection(action, selection.citation, selection.selectedMarkdown);
    }
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
            onClick={() => ask("ask-in-side-chat")}
          >
            <PanelRightIcon aria-hidden="true" className="size-3.5" />
            Ask in side chat
          </Button>
        </>
      ) : null}
    </div>,
    portalContainer ?? document.body,
  );
}
