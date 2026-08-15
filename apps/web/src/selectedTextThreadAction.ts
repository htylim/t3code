import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";

import type { DraftId } from "./composerDraftStore";
import { chatMarkdownClipboardPayload } from "./markdown-clipboard";
import { serializeThreadReferenceMarkdown } from "./threadReference";

export type SelectedTextThreadAction = "ask-in-new-thread" | "ask-in-side-chat";

export const SELECTED_TEXT_THREAD_CONTEXT_MENU_ITEMS = [
  { id: "ask-in-new-thread", label: "Ask in new thread" },
  { id: "ask-in-side-chat", label: "Ask in side chat" },
] as const satisfies readonly ContextMenuItem<SelectedTextThreadAction>[];

function nodeElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function chatMarkdownRoot(node: Node): Element | null {
  return nodeElement(node)?.closest(".chat-markdown") ?? null;
}

/**
 * Reads one selection from one rendered chat message. Keeping both endpoints
 * in the same Markdown root prevents timeline chrome or adjacent messages from
 * leaking into the new draft.
 */
export function readSelectedChatMarkdown(
  selection: Selection,
  timelineContainer: Element,
): string | null {
  if (selection.isCollapsed || selection.rangeCount === 0) return null;

  let selectedRoot: Element | null = null;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) continue;
    const startRoot = chatMarkdownRoot(range.startContainer);
    const endRoot = chatMarkdownRoot(range.endContainer);
    if (
      startRoot === null ||
      endRoot !== startRoot ||
      !timelineContainer.contains(startRoot) ||
      (selectedRoot !== null && selectedRoot !== startRoot)
    ) {
      return null;
    }
    selectedRoot = startRoot;
  }

  if (selectedRoot === null) return null;
  return chatMarkdownClipboardPayload(selection)?.text.trim() || null;
}

function markdownBlockquote(markdown: string): string {
  return markdown
    .trim()
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function buildAskInNewThreadPrompt(input: {
  readonly selectedMarkdown: string;
  readonly sourceThreadTitle: string;
  readonly sourceThreadRef: ScopedThreadRef;
}): string {
  const source = serializeThreadReferenceMarkdown(input.sourceThreadTitle, input.sourceThreadRef);
  return `Regarding this selection from ${source}:\n\n${markdownBlockquote(input.selectedMarkdown)}\n\n`;
}

export async function showSelectedTextThreadContextMenu(input: {
  readonly position: { readonly x: number; readonly y: number };
  readonly showContextMenu: (
    items: readonly ContextMenuItem<SelectedTextThreadAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<SelectedTextThreadAction | null>;
}): Promise<SelectedTextThreadAction | null> {
  return input.showContextMenu(SELECTED_TEXT_THREAD_CONTEXT_MENU_ITEMS, input.position);
}

export async function createSelectedTextThreadDraft(input: {
  readonly prompt: string;
  readonly createThread: () => Promise<unknown>;
  readonly findCreatedDraft: () => { readonly draftId: DraftId } | null;
  readonly setPrompt: (draftId: DraftId, prompt: string) => void;
}): Promise<void> {
  await input.createThread();
  const draft = input.findCreatedDraft();
  if (draft === null) {
    throw new Error("The new thread draft could not be found.");
  }
  input.setPrompt(draft.draftId, input.prompt);
}
