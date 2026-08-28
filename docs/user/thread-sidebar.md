# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Continue another thread in the right panel

On web and desktop, open a different thread's context menu and choose **Open in side surface**.
The thread opens in the current chat's right panel without changing the main chat. You can follow
its live timeline, send a message, stop its current work, and answer approvals or questions. The
side chat uses the same message rendering and composer as the main chat. It supports image
attachments, provider and model controls, permission and interaction modes, `%` thread references,
`$` skills, and `@` file or folder references.

Press `mod+t` (`Cmd+T` on macOS, `Ctrl+T` elsewhere) to create a blank side chat from the current
main chat. It inherits the main chat's environment, project, model and model options, permission
mode, interaction mode, branch, and worktree at creation time. Those settings then belong to the
new thread and do not stay linked to later changes in the main chat. T3 Code treats this new side
chat as transient. It stays out of this client's thread lists and search results, and closing or
replacing its side surface deletes the T3 thread. The provider may retain its own native transcript.
The shortcut is the `chat.newSide` command and can be changed in **Settings** → **Keybindings**.
Desktop receives the default shortcut directly; web browsers normally reserve `Cmd/Ctrl+T`, so bind
another shortcut when using the web client.

You can also choose **Chat** from the right panel's surface controls to create the same blank side
chat.

The Chat surface belongs to the main thread where you opened it. Moving to another main thread
hides that right panel; returning restores it during the same app session. Threads opened through
**Open in side surface** remain ordinary persistent threads, so closing only removes that view.
Blank side chats and chats created through **Ask in side chat** are transient and are deleted when
their surface closes.

Transient side surfaces are not restored after T3 Code quits. Their IDs remain in browser storage
until deletion succeeds. On the next launch, T3 Code deletes any transient thread left behind by a
normal quit, crash, or forced termination after that thread's environment reconnects.

When you send from the side surface, T3 Code tells the agent which main thread owns the surface.
The agent can use `thread_read` when it needs that conversation. This context is not added to the
visible user message. T3 Code omits it when the main thread belongs to another environment.
Otherwise, it tells the agent to use `thread_read` only when the provider exposes T3's thread tools.

Each main thread can hold one Chat surface. Opening a different target replaces the previous Chat
surface after you confirm the replacement. Replacing a transient side chat also deletes its T3
thread. Reopening the current target does not ask for confirmation. Forking, checkpoint restore,
terminal capture, and links to other right-panel surfaces remain available only from the main chat.

## Return to your reading position

On web and desktop, switching away from a thread keeps your reading position for the rest of the
app session. Returning restores the same timeline row and position within it, even if row heights
changed while you were away. Reaching the live edge or sending a message clears the saved position.
Reloading the app also clears it.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
