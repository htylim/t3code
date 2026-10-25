import * as Schema from "effect/Schema";
import { EnvironmentId, MessageId, NonNegativeInt, ThreadId } from "./baseSchemas.ts";

export const ASSISTANT_CITATION_MAX_TEXT_LENGTH = 8_000;
export const ASSISTANT_CITATION_MAX_COMMENT_LENGTH = 8_000;
export const ASSISTANT_CITATION_CONTEXT_LENGTH = 32;

const CitationThread = {
  environmentId: EnvironmentId.check(Schema.isMaxLength(512)),
  threadId: ThreadId.check(Schema.isMaxLength(512)),
};

export const AssistantCitationSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("assistant-message"),
    ...CitationThread,
    messageId: MessageId.check(Schema.isMaxLength(512)),
  }),
  Schema.Struct({
    kind: Schema.Literal("html-attachment"),
    ...CitationThread,
    itemId: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
    attachmentId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    title: Schema.String.check(Schema.isMaxLength(200)),
  }),
]);
export type AssistantCitationSource = typeof AssistantCitationSource.Type;

/** Positions are UTF-16 offsets in normalized rendered text, not Markdown or HTML offsets. */
const CitationQuote = {
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  comment: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_MAX_COMMENT_LENGTH)),
  ),
  start: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  end: NonNegativeInt.check(Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
};

/** V1 links stay readable; new citations identify their message or HTML attachment explicitly. */
export const AssistantCitation = Schema.Union([
  Schema.Struct({
    version: Schema.Literal(1),
    ...CitationThread,
    messageId: MessageId.check(Schema.isMaxLength(512)),
    ...CitationQuote,
  }),
  Schema.Struct({
    version: Schema.Literal(2),
    source: AssistantCitationSource,
    ...CitationQuote,
  }),
]).check(
  Schema.makeFilter((citation) => citation.end > citation.start && citation.text.trim().length > 0),
);
export type AssistantCitation = typeof AssistantCitation.Type;
