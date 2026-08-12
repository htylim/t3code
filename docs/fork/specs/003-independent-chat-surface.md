# Compact Chat Right-Panel Surface Plan

## Status

Implementation plan agreed on 2026-08-11 for the downstream fork. This replaces the earlier plan
for a fully independent second instance of the primary chat.

The feature is intentionally smaller so it can remain isolated from upstream's frequently changing
primary chat implementation and keep future upstream merges manageable.

## Intent

Allow a user to open an existing thread as a compact, working Chat surface in the right panel while
remaining on the current main thread.

The compact Chat surface is not a second copy of the full application chat. It provides the small
set of thread-local interactions needed to monitor and continue another thread without navigating
away from the main chat.

## Right-Panel Lifetime

The Chat surface follows the existing right-panel lifetime model. It belongs to the main thread
from which it was opened, just like that thread's File, Diff, Browser, Terminal, or Agents surfaces.

For example:

1. Main thread A opens thread B in a Chat surface.
2. The surface is stored in A's existing right-panel state.
3. Navigating the main view from A to C hides A's entire right panel, including B's Chat surface.
4. Returning to A restores the surface and its selected tab.
5. Thread B may continue running while its surface is hidden. Hiding or unmounting the view does not
   interrupt or otherwise modify B.

The Chat surface does not survive as a globally pinned panel when the main route changes. No new
application-level panel lifetime or navigation root will be introduced.

## Desired User Experience

1. A user opens an existing thread's context menu in the sidebar.
2. The menu contains **Open in side surface** when the target is eligible.
3. Choosing it opens the target thread in the current main thread's right panel without navigating
   the main chat.
4. The surface shows the target thread's timeline, current work state, and a compact composer.
5. The user can send plain-text messages, interrupt work, and answer pending approvals or questions
   from the surface.
6. Main and side threads may run concurrently. Each view displays updates belonging to its own
   thread.
7. Navigating away from the owning main thread hides the surface under the ordinary right-panel
   lifetime rules. Returning restores it.
8. Closing the surface closes only the view. It does not stop, delete, settle, or otherwise modify
   the target thread.
9. Reopening the same target for the same owning thread activates the existing surface rather than
   creating a duplicate.

## Surface Identity

A Chat surface descriptor contains the target environment and thread IDs. Its identity is derived
from that scoped thread reference, for example `chat:<environment-id>:<thread-id>`.

The surrounding right-panel state remains keyed by the owning main thread through the existing
`byThreadKey` model. The owner and target therefore have separate meanings:

- **Owner:** the routed main thread whose right-panel tab set contains the surface.
- **Target:** the thread displayed and controlled inside the Chat surface.

Opening the current main thread as its own Chat surface is unavailable. Showing the same thread in
both columns would add confusion without providing useful independence.

The first release supports one Chat surface in an owning thread's right panel. Opening a different
target asks for confirmation before replacing the existing Chat surface. Reopening the current
target activates it without confirmation. The compact composer draft is thread-scoped, so replacing
or hiding the surface must not discard unsent text.

## First-Release Capabilities

The compact Chat surface supports:

- Creating a blank side thread from a saved or local-draft main chat through the configurable
  `chat.newSide` command or the right panel's **Chat** surface action.
- Creating a prefilled side thread from selected main-chat text through **Ask in side chat**.
- Snapshotting the main chat's environment, project, model options, runtime/permission mode,
  interaction mode, branch, and worktree into that new side thread.
- Loading and displaying the target thread's conversation timeline.
- Receiving live progress, messages, errors, completion state, approvals, and user-input requests.
- A persisted, thread-scoped plain-text draft.
- Sending a plain-text message when the target thread can accept it.
- Interrupting the target thread's current work.
- Responding to pending approvals.
- Responding to pending user-input questions.
- Clear loading, disconnected, unavailable, and deleted-thread states.
- A recognizable title that follows ordinary target-thread title changes.

All mutations must use the existing client-runtime thread commands and orchestration contracts with
the target's explicit scoped thread reference. The compact surface must not implement a second
sending, interruption, approval, or user-input protocol.

## Explicit First-Release Limitations

The compact Chat surface does not support:

- Forking the target thread.
- Implementing a plan in another thread.
- Pull-request or project actions that create or navigate to another thread.
- Checkpoint revert or restore.
- Composer attachments, images, terminal context, element context, preview annotations, or review
  comments.
- File, skill, command, or thread-reference pickers.
- App-owned slash-command behavior.
- Changing provider, model, effort, runtime mode, or interaction mode.
- Queued follow-up messages while the target cannot accept a new message.
- Opening Files, Diff, Browser, Terminal, Agents, or another Chat surface from inside the compact
  Chat surface.
- A nested sidebar, project navigation, branch toolbar, or other application navigation controls.
- Full primary-chat keyboard-command parity.

Plans and other rich thread output may appear in the timeline as ordinary rendered thread content,
but the compact surface does not add their specialized follow-up controls in the first release.

Unavailable features must be absent or clearly disabled. They must never fall back to operating on
the owning main thread.

## Compact Implementation

The feature will use a fork-owned compact implementation rather than refactoring the primary
`ChatView` and `ChatComposer` into a reusable application framework.

The implementation should:

- Add a small `CompactChatSurface`-style component that always receives its target thread
  explicitly.
- Reuse existing thread projections, commands, stores, and stable leaf presentation components
  where useful.
- Use the existing thread-scoped composer draft state as the single source of truth where its APIs
  support the compact editor without importing the full primary composer.
- Keep surface-specific presentation state inside fork-owned modules.
- Avoid reading the target from router parameters.
- Avoid navigation calls from the compact surface.
- Avoid copying `ChatView`, `ChatComposer`, or their large controller logic wholesale.

Some small visual or interaction components may resemble or reuse pieces of the main chat, but the
compact surface is intentionally a separate, limited product surface. It does not promise automatic
feature parity with every future upstream addition to the primary chat.

## Shortcut and Focus Rules

The main `ChatView` currently installs a capture-phase global keyboard handler. Without a guard,
configured shortcuts pressed while interacting with the compact Chat surface could operate on the
owning main thread.

The compact surface will mark its root element so the existing global handler can recognize the
event origin.

When a keyboard event originates inside the compact Chat surface:

- Ordinary typing and editing remain local to its editor.
- Its local submit behavior targets only the compact surface's target thread.
- Right-panel commands that operate on the containing panel, such as closing the active surface,
  may continue to work.
- `chat.newSide` may create and replace the side target owned by the current main chat.
- Application-wide commands may retain their existing application-wide behavior where that is
  unambiguous.
- Main-thread terminal commands, Diff toggle, model-picker toggle, project-script shortcuts, and
  other thread- or workspace-targeted commands are ignored.

The compact surface does not register a competing global shortcut handler. It owns only local editor
and control interactions. No key pressed from inside it may silently send input to or mutate the
owning main thread.

## Related Right-Panel Surfaces

The first release exposes no entry points from the compact Chat surface to Files, Diff, Browser,
Terminal, Agents, or other thread-related surfaces.

This is deliberate. Existing related surfaces contain assumptions about the routed main thread.
Disabling those entry points avoids accidentally showing or mutating the owning thread's context and
keeps the downstream patch narrow. Explicit target-aware related surfaces may be evaluated later as
separate features.

## Target Availability

If the target thread is deleted, becomes unavailable, or its environment disconnects, the Chat
surface must remain bound to that exact target and show a clear state. It must never silently display
the owning thread or another available thread.

The user must always be able to close an unavailable Chat surface safely. Reconnection may restore
the target in place when the existing client-runtime state does so normally.

## Upstream Synchronization Strategy

This feature is a downstream fork addition and should minimize edits to upstream-owned hotspots.

Most behavior should live in new fork-owned modules. Existing files should receive only narrow
integration seams for:

- The `chat` right-panel surface descriptor and persistence handling.
- Right-panel tab title, icon, activation, closing, and rendering.
- **Open in side surface** in the web sidebar thread menus.
- The configurable `chat.newSide` command, defaulting to `mod+t` outside terminal focus.
- **Chat** in the right-panel surface controls and **Ask in side chat** for selected message text.
- The global-keyboard-handler origin guard.

The implementation should avoid:

- A broad `ChatView` decomposition.
- A replacement composer architecture.
- New server orchestration or provider protocols.
- New contracts when existing explicit thread commands are sufficient.
- Route or application-layout changes for global panel persistence.
- Duplicated copies of large upstream components.

The goal is not zero downstream maintenance. The goal is to keep conflicts visible, small, and near
stable integration points while preventing semantic drift in thread mutations.

## Fixed Decisions

| Area                | Decision                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| Entry point         | Thread menu, right-panel Chat action, selected text, or `chat.newSide`  |
| Panel lifetime      | Same owner-thread-scoped lifetime as existing right-panel surfaces      |
| Main navigation     | Hides the owner's Chat surface; returning to the owner restores it      |
| Target              | Explicit environment and thread IDs stored in the surface descriptor    |
| Implementation      | Separate fork-owned compact UI, not a reusable full `ChatView` refactor |
| First-release count | One Chat surface per owning thread; a different target replaces it      |
| Composer            | Persisted plain-text draft and direct send only                         |
| Thread controls     | Send, interrupt, approvals, and user-input responses                    |
| Related surfaces    | Unavailable from the compact Chat surface                               |
| Shortcuts           | Local editor controls plus safe panel/application commands only         |
| Closing             | Closes only the view and never mutates the target thread                |
| Clients             | Web and desktop first; mobile is out of scope                           |

## Delivery Plan

### 1. Add the Surface Model

Add the Chat surface descriptor, owner-thread persistence behavior, deduplication, replacement, tab
presentation, and unavailable-target handling to the existing right-panel model.

### 2. Build the Compact Thread View

Create the fork-owned timeline and compact composer against explicit target-thread state. Add
plain-text sending, interruption, approvals, user-input responses, status, errors, and persisted
draft behavior using existing client-runtime commands.

### 3. Add Entry Points and Shortcut Safety

Add the eligible thread-menu action to both web sidebars. Mark the compact surface and filter
main-chat global shortcuts by event origin while preserving safe right-panel and application-wide
commands.

### 4. Verify Isolation and Upstream Boundaries

Use focused tests to prove that every compact-surface mutation targets the descriptor's target
thread, never the owning routed thread. Verify ordinary right-panel lifetime behavior, hidden-thread
continuation, draft restoration, target deletion, and closing semantics. Review the final diff to
keep upstream-owned changes narrow.

## Acceptance Criteria

- A saved or local-draft main chat can create a blank side thread through `chat.newSide` without
  navigating, inheriting its current project, model options, runtime/permission mode, interaction
  mode, branch, and worktree.
- The right-panel **Chat** action creates the same blank side thread.
- **Ask in side chat** creates that side thread with the selected-text prompt prefilled and unsent.
- Main thread A can open existing thread B in a compact Chat surface without navigating away.
- The surface is stored with A's other right-panel state.
- Navigating from A to C hides B's Chat surface, and returning to A restores it.
- B may continue running while the surface is hidden.
- The surface displays B's timeline and live state, never A's.
- Sending and interrupting from the surface affect only B.
- Approval and user-input responses from the surface affect only B.
- Unsent plain text survives tab changes, replacement, hiding, and reopening according to the
  thread-scoped draft store.
- Unsupported controls and related-surface entry points are absent or disabled.
- Typing and local submit behavior in the surface cannot target A.
- Allowed panel shortcuts operate on the panel; ignored thread-specific shortcuts do not operate on
  A while focus is inside the compact surface.
- Closing the surface leaves B and its running work untouched.
- Deleting or losing access to B never causes the surface to display another thread.
- Reopening B for owner A activates the existing surface rather than creating a duplicate.
- Opening another target for owner A replaces the previous Chat surface without discarding that
  target's persisted draft, but only after confirmation.
- Web and desktop expose the same behavior through the shared web client.
- The implementation adds no mobile behavior, provider protocol, server orchestration, or global
  panel lifetime.

## Future Possibilities

Future work may independently consider:

- Multiple Chat tabs per owning thread.
- Attachments or richer composer controls.
- Target-aware related surfaces opened from the compact chat.
- Selected additional local shortcuts.
- Rich plan and checkpoint interactions.

These are additions to the compact surface, not commitments to turn it into a second full primary
chat.

## What We Are Not Doing

- Building a globally pinned secondary chat that survives main-thread navigation.
- Refactoring the entire primary chat into a reusable multi-instance framework.
- Copying the full primary `ChatView` or `ChatComposer` implementation.
- Promising feature parity with the primary chat.
- Letting compact-surface actions fall back to the routed main thread.
- Adding nested application navigation.
- Adding mobile support in the first release.
