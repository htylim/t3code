# Reference another thread

On web or desktop, type `%` to find a thread in the project where you are writing, or `%%` to search
all projects in the current environment. Results show the most recent user activity first, falling
back to creation time for threads without a user message. Archived threads and the current thread
are excluded.

Keep typing to search by thread title, ID, project, or branch. Spaces continue the query. Choose a
result with the mouse, Enter, or Tab, or press Escape to close the picker and keep your text.
After Escape, continuing to type leaves the picker closed; start a fresh `%` or `%%` query to reopen
it. Both triggers must start at the beginning of the prompt or after whitespace.

The composer inserts ordinary Markdown such as:

```text
[Investigate startup time](t3code://threads/local/thread-123)
```

The reference appears as a chip while you write. After you send the message, the chip opens that
thread inside T3. References to threads that were later removed use the normal missing-thread
fallback.

The title is a snapshot from when you inserted the reference. Renaming the target thread does not
rewrite old messages.

A reference does not automatically copy or load the other conversation. Ask the agent to inspect
the reference when you want it to read the target through T3's thread tools.

## Ask about selected text in a new thread

On web or desktop, select text within one assistant message. In the floating selection toolbar,
choose **Cite** to insert a citation in the current composer, **Ask in new thread** to open a new
main-chat draft with a Markdown quote and source-thread reference, or **Ask in side chat** to
create a transient draft in the right panel with a citation to the selection. The side chat
already receives the main thread as provider context. Nothing is sent automatically, so you can
add your question before submitting it.

All three actions use the same selection rules: select at most 8,000 characters within one
assistant message. Selections in user messages or across messages do not offer these actions.

Thread references are available in the web and desktop main and side-chat composers. The native
iOS and Android composers do not offer the `%` picker in this version.
