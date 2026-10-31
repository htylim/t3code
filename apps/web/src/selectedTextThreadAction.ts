import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import {
  assistantCitationSource,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";

import { type DraftId } from "./composerDraftStore";
import { formatInlineContextReference } from "./lib/composerContextReferences";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";
import { threadContextReference } from "./lib/composerContextRecords";

export type SelectedTextThreadAction = "ask-in-new-thread" | "ask-in-side-chat";

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
    return `Regarding this selection from ${source}:\n\n${serializeAssistantCitation(input.citation)}\n\n`;
  }
  return `Regarding this selection from ${source}:\n\n${markdownBlockquote(input.selectedMarkdown)}\n\n`;
}

export function buildAskInSideChatPrompt(assistantCitation: AssistantCitation): string {
  return `${serializeAssistantCitation(assistantCitation)} `;
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
