# Reference another thread

On web or desktop, type `%` at the start of a composer token to find an active thread in the current
environment. Keep typing to search by thread title, ID, project, or branch, then choose a result with
the mouse or keyboard.

The composer inserts ordinary Markdown such as:

```text
[Investigate startup time](t3code://threads/local/thread-123)
```

The raw Markdown stays visible while you write. After you send the message, T3 renders it as a
thread chip. The chip opens that thread inside T3. References to threads that were later removed use
the normal missing-thread fallback.

The title is a snapshot from when you inserted the reference. Renaming the target thread does not
rewrite old messages.

A reference does not automatically copy or load the other conversation. Ask the agent to inspect
the reference when you want it to read the target through T3's thread tools.

## Ask about selected text in a new thread

On web or desktop, select text inside one chat message and right-click it. Choose **Ask in new
thread** to open a new main-chat draft, or **Ask in side chat** to create and open the draft in the
right panel. Both choices use the same project and prefill the composer with the selected text as a
Markdown quote and a reference to the source thread. Nothing is sent automatically, so you can add
your question before submitting it.

Selections that cross message boundaries keep the normal system context menu instead.

Thread references are available in the web and desktop composers. The native iOS and Android
composers do not offer the `%` picker in this version.
