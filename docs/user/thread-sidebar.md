# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

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
side-chat composer supports the same `%` thread references, `$` skills, and `@` file or folder
references as the main composer.

Press `mod+t` (`Cmd+T` on macOS, `Ctrl+T` elsewhere) to create a blank side chat from the current
main chat. It inherits the main chat's environment, project, model and model options, permission
mode, interaction mode, branch, and worktree at creation time. Those settings then belong to the
new thread and do not stay linked to later changes in the main chat. The shortcut is the
`chat.newSide` command and can be changed in **Settings** → **Keybindings**. Desktop receives the
default shortcut directly; web browsers normally reserve `Cmd/Ctrl+T`, so bind another shortcut
when using the web client.

You can also choose **Chat** from the right panel's surface controls to create the same blank side
chat.

The Chat surface belongs to the main thread where you opened it. Moving to another main thread
hides that right panel; returning restores it. Closing the surface only closes the view and does
not stop or delete the thread.

Each main thread can hold one Chat surface. Opening a different target replaces the previous Chat
surface after you confirm the replacement, while each target's unsent text remains saved. Reopening
the current target does not ask for confirmation. The compact composer does not include image
attachments, provider or model controls, plan actions, checkpoint restore, or links to other
right-panel surfaces.
