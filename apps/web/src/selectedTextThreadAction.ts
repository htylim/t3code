import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import {
  assistantCitationSource,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";

import { type DraftId, useComposerDraftStore } from "./composerDraftStore";
import { formatInlineContextReference } from "./lib/composerContextReferences";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { threadContextReference } from "./lib/composerContextRecords";

type SelectionChatAction = "ask-in-side-chat" | "ask-in-parent";

export type SelectedTextThreadAction = "ask-in-new-thread" | SelectionChatAction;

export interface SelectedTextThreadActions {
  readonly ask: SelectedTextThreadActionHandler;
  readonly chatAction: SelectionChatAction | null;
}

export type SelectedTextThreadActionHandler = (
  action: SelectedTextThreadAction,
  citation: AssistantCitation,
  selectedMarkdown: string,
) => Promise<void>;

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
  readonly citation?: AssistantCitation;
}): string {
  const source = formatInlineContextReference(
    threadContextReference(threadContextRecord(input.sourceThreadRef, input.sourceThreadTitle)),
  );
  if (input.citation && assistantCitationSource(input.citation).kind === "html-attachment") {
    // oxlint-disable-next-line t3code/no-untranslated-copy -- prompt sent to the agent, not UI copy
    return `Regarding this selection from ${source}:\n\n${serializeAssistantCitation(input.citation)}\n\n`;
  }
  // oxlint-disable-next-line t3code/no-untranslated-copy -- prompt sent to the agent, not UI copy
  return `Regarding this selection from ${source}:\n\n${markdownBlockquote(input.selectedMarkdown)}\n\n`;
}

/** Builds an unsent citation with space for a question after it. */
export function buildSelectedCitationPrompt(assistantCitation: AssistantCitation): string {
  return `${serializeAssistantCitation(assistantCitation)} `;
}

/** Appends a selection to a thread's unsent draft without replacing existing text. */
export function appendSelectionToThreadDraft(threadRef: ScopedThreadRef, selectionPrompt: string) {
  const drafts = useComposerDraftStore.getState();
  const existingPrompt = drafts.getComposerDraft(threadRef)?.prompt ?? "";
  const separator = existingPrompt && !/\s$/.test(existingPrompt) ? " " : "";
  drafts.setPrompt(threadRef, `${existingPrompt}${separator}${selectionPrompt}`);
}

/** Prefill the exact draft returned by navigation, including reused project drafts. */
export async function createSelectedTextThreadDraft(input: {
  readonly prompt: string;
  readonly createThread: () => Promise<{ readonly draftId: DraftId } | null>;
  readonly setPrompt: (draftId: DraftId, prompt: string) => void;
}): Promise<void> {
  const draft = await input.createThread();
  if (draft === null) {
    throw new Error("The new thread draft could not be found.");
  }
  input.setPrompt(draft.draftId, input.prompt);
}
