import * as Schema from "effect/Schema";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const THREAD_TAG_LABEL_MAX_LENGTH = 120;

/** One explicit label. An absent tag uses the thread's project label and icon. */
export const ThreadTag = Schema.Struct({
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(THREAD_TAG_LABEL_MAX_LENGTH)),
});
export type ThreadTag = typeof ThreadTag.Type;

/** Environment-local overrides, separate from upstream thread projections. */
export const ThreadTags = Schema.Record(Schema.String, ThreadTag);
export type ThreadTags = typeof ThreadTags.Type;

export const SetThreadTagInput = Schema.Struct({
  threadId: ThreadId,
  tag: Schema.NullOr(ThreadTag),
});
export type SetThreadTagInput = typeof SetThreadTagInput.Type;

/** Persistence and missing-thread failures retain their cause on the server. */
export class ThreadTagError extends Schema.TaggedError<ThreadTagError>()("ThreadTagError", {
  operation: Schema.Literals(["read", "write", "thread-not-found"]),
  cause: Schema.Defect(),
}) {
  /** Return a stable message without exposing filesystem or database details. */
  override get message(): string {
    if (this.operation === "thread-not-found") return "This thread no longer exists.";
    return `Failed to ${this.operation} thread tags.`;
  }
}
