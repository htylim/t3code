import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useRef } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { readLocalApi } from "../../localApi";
import {
  buildAskInNewThreadPrompt,
  createSelectedTextThreadDraft,
  readSelectedChatMarkdown,
  showSelectedTextThreadContextMenu,
} from "../../selectedTextThreadAction";
import { stackedThreadToast, toastManager } from "../ui/toast";

interface AskInNewThreadSelectionSurfaceProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly enabled: boolean;
  readonly projectRef: ScopedProjectRef | null;
  readonly sourceThreadRef: ScopedThreadRef;
  readonly sourceThreadTitle: string;
  readonly createThread: (projectRef: ScopedProjectRef) => Promise<unknown>;
  readonly createSideThread: (prompt: string) => Promise<void>;
}

export function AskInNewThreadSelectionSurface({
  children,
  className,
  enabled,
  projectRef,
  sourceThreadRef,
  sourceThreadTitle,
  createThread,
  createSideThread,
}: AskInNewThreadSelectionSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleContextMenuCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!enabled || projectRef === null || container === null || selection === null) return;

      const selectedMarkdown = readSelectedChatMarkdown(selection, container);
      if (selectedMarkdown === null) return;

      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api) return;

      const position = { x: event.clientX, y: event.clientY };
      const prompt = buildAskInNewThreadPrompt({
        selectedMarkdown,
        sourceThreadTitle,
        sourceThreadRef,
      });

      void (async () => {
        try {
          const action = await showSelectedTextThreadContextMenu({
            position,
            showContextMenu: (items, menuPosition) => api.contextMenu.show(items, menuPosition),
          });
          if (action === null) return;

          if (action === "ask-in-side-chat") {
            await createSideThread(prompt);
            return;
          }

          const store = useComposerDraftStore.getState();
          await createSelectedTextThreadDraft({
            prompt,
            createThread: () => createThread(projectRef),
            findCreatedDraft: () => store.getDraftSessionByProjectRef(projectRef),
            setPrompt: store.setPrompt,
          });
        } catch (cause) {
          console.error("[selected-text-thread] action failed", cause);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create thread from selection",
              description: cause instanceof Error ? cause.message : "An unexpected error occurred.",
            }),
          );
        }
      })();
    },
    [createSideThread, createThread, enabled, projectRef, sourceThreadRef, sourceThreadTitle],
  );

  return (
    <div ref={containerRef} className={className} onContextMenuCapture={handleContextMenuCapture}>
      {children}
    </div>
  );
}
