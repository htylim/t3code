import type { OrchestrationV2Run } from "@t3tools/contracts";

/** Add owning-thread context for the provider while leaving the saved message unchanged. */
export function projectSideChatContextForProvider(
  text: string,
  context: OrchestrationV2Run["sideChatContext"],
): string {
  if (!context) return text;
  return `<side_chat_context>
This is a side chat thread. Its owning main T3 thread ID is ${JSON.stringify(context.mainThreadId)}.
When that thread's contents matter, read it with t3_thread_read and page with afterPosition=nextPosition. Do not assume its contents without reading it. Do not message or modify it unless asked.
</side_chat_context>\n\n${text}`;
}
