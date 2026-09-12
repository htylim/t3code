import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";

import type { DraftId } from "./composerDraftStore";
import { serializeThreadReferenceMarkdown } from "./threadReference";

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
}): string {
  const source = serializeThreadReferenceMarkdown(input.sourceThreadTitle, input.sourceThreadRef);
  return `Regarding this selection from ${source}:\n\n${markdownBlockquote(input.selectedMarkdown)}\n\n`;
}

export function buildAskInSideChatPrompt(assistantCitation: AssistantCitation): string {
  return `${serializeAssistantCitation(assistantCitation)} `;
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
