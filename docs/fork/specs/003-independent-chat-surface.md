# Independent Chat Surface Product Plan

## Status

Product plan captured on 2026-08-07. The intended experience, requirements, constraints, and scope
are recorded here. Implementation design is intentionally deferred until the code work begins.

## Intent

Allow a user to keep another thread open as a Chat surface in the right panel while continuing to
use the main chat normally. The secondary chat is a real, independent working conversation rather
than a transcript preview or a limited companion view.

The main and secondary chats should feel like two instances of the same chat experience. They may
show different threads, run work concurrently, hold different unsent drafts, and receive input
without affecting one another.

T3 should ultimately support multiple Chat surfaces. A first release may expose only one secondary
Chat surface, provided the product direction does not treat the singleton limit as permanent.

## Desired User Experience

1. A user opens a thread's context menu in the sidebar.
2. The menu contains **Open in Chat Surface**.
3. Choosing it opens that thread as a Chat surface in the right panel without navigating the main
   chat away from its current thread.
4. The secondary chat shows the same conversation and composer experience expected from the main
   chat for operations that stay within that thread.
5. The user can move focus between the main and secondary chats and operate either one directly.
6. Both threads may have work running at the same time. Updates, approvals, questions, errors, and
   completion state appear in the chat they belong to.
7. Navigating the main chat to another thread does not retarget, reset, or close the secondary
   chat.
8. Closing the Chat surface closes only that view. It does not stop, delete, settle, or otherwise
   modify the displayed thread.
9. Reopening the same thread returns to its existing Chat surface rather than creating an
   accidental duplicate.

## Product Requirements

### Independent Thread State

Each chat must independently preserve and display the state belonging to its own thread, including:

- Conversation timeline and live progress.
- Timeline position and local presentation state where users reasonably expect it to survive.
- Composer text, attachments, and other unsent context.
- Selected provider, model, effort, runtime mode, and interaction mode.
- Optimistic messages, send state, and thread-specific errors.
- Pending approvals and user-input questions.
- Proposed plans and other thread-local follow-up state.

Activity in one chat must never be attributed to, rendered in, or submitted to the other chat.

### Supported Thread-Local Actions

The secondary chat must support actions whose target remains the thread displayed in that chat,
including:

- Sending messages and queued follow-ups.
- Interrupting the thread's current work.
- Responding to approvals and user-input requests.
- Editing and submitting composer attachments and context.
- Changing model, effort, runtime, and interaction choices when the thread normally permits it.
- Using provider commands, slash commands, skills, and other composer features that operate on the
  displayed thread.
- Refining or continuing plans within the same thread.
- Reverting or restoring thread checkpoints when the main chat would allow the same operation.

Feature availability should continue to follow the thread, provider, environment, and project
capabilities that already govern the main chat. Opening a thread in a Chat surface must not grant
capabilities that the thread does not otherwise have.

### Actions That Leave the Thread

The secondary chat is not a second application navigation root. Actions whose result is another
thread are available only from the main chat in the first release. This includes:

- Creating a new thread.
- Forking the current thread.
- Implementing a plan in a new thread.
- Pull-request or project flows that create a thread or navigate to another thread.
- Any future action whose primary result is replacing the current thread with a different one.

These actions should be absent or clearly unavailable in the secondary chat. They must never fall
back to navigating or replacing the main chat.

### Focus and Command Targeting

The user must always be able to tell which chat will receive an action. Direct interaction with a
chat makes that chat the target for chat-local keyboard commands and composer operations.

When the secondary chat has focus, a thread-local command must act on the secondary thread. When
the main chat has focus, it must act on the main thread. Workspace-wide commands may retain their
existing application-wide behavior, but they must not infer a thread target incorrectly from the
main route when the command is meant for the focused chat.

No shortcut, command-palette action, composer action, or automatic focus behavior may silently
send input to the wrong chat.

### Other Right-Panel Surfaces

When an action originating from a secondary chat opens another thread-related surface, that
surface must use the secondary thread's context. For example, Diff, Files, Browser, Terminal, Plan,
or Agents opened from secondary thread B must not show or operate on main thread A merely because A
is the routed thread.

Opening another surface may temporarily replace the visible Chat surface within the right panel,
as ordinary surface tab selection does today. The Chat surface must remain available so the user
can return to the same secondary conversation.

If a particular related surface cannot be safely targeted to the secondary thread in the first
release, its entry point must be unavailable from the secondary chat rather than operating on the
wrong thread.

### Surface Identity and Lifetime

- A Chat surface is identified by the environment and thread it displays.
- The surface title should make the displayed thread recognizable and should follow ordinary title
  changes.
- The main chat and a Chat surface may display threads from different projects or environments.
- Opening the thread already displayed in the main chat as a secondary Chat surface should be
  prevented; showing the same thread twice provides no useful independence.
- Navigating or refreshing the main chat should not change the secondary Chat surface's target.
- If the secondary thread becomes unavailable, deleted, or disconnected, the surface should show a
  clear state and offer a safe way to close it. It must not silently display another thread.

## Reuse Requirement

The main and secondary chats must share one chat experience. The secondary chat must not be built
as a copied or permanently reduced implementation that will drift as the main chat evolves.

Work may first be required to make the existing main chat reusable in more than one place. That
foundational work is part of this feature, and preserving the existing main-chat behavior during
the transition is a requirement.

The primary and secondary roles may intentionally expose different navigation capabilities, but
thread-local behavior should come from the same product surface and remain consistent between
them.

## Fixed Product Decisions

| Area                    | Decision                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Entry point             | **Open in Chat Surface** in the individual thread context menu                      |
| Main behavior           | Opening a Chat surface does not navigate or replace the main chat                   |
| Independence            | Main and secondary chats have separate thread, composer, focus, and live-work state |
| Local actions           | Supported when they continue operating on the displayed thread                      |
| Thread-changing actions | Main chat only in the first release                                                 |
| Related surfaces        | Must use the originating chat's thread context or be unavailable                    |
| Main navigation         | Does not retarget or close an existing Chat surface                                 |
| Closing                 | Closes only the surface; it does not mutate the thread                              |
| Reuse                   | Main and secondary chats share the same reusable chat experience                    |
| First release           | One secondary Chat surface is acceptable                                            |
| Product direction       | Multiple independent Chat surfaces are desired                                      |
| Clients                 | Web and desktop first; mobile is separate future work                               |

## First-Release Scope

The first release is complete when one independent secondary Chat surface can be opened from a
thread menu and used for the full set of supported thread-local interactions while the main chat
continues to operate normally.

It is acceptable for the first release to replace the existing secondary Chat surface when the
user chooses another thread. The user should not lose unsent thread-specific composer content as a
result, and the product must not imply that multiple Chat surfaces are ruled out permanently.

The first release should work in the web client and in desktop, which inherits the web experience.
Narrow layouts may present the right panel as an overlay rather than showing two chats side by
side, but thread independence and correct command targeting still apply.

## Future Scope

After the independent single-surface experience is established, allow several Chat surfaces to be
open as separate right-panel tabs. Each one should retain its own target and local presentation
state, and selecting one should make it the active secondary chat without changing the main chat.

The first-release product model must not make this extension require redefining what a Chat surface
is or how independence works.

## What We Are Not Doing

- Building a read-only transcript preview.
- Building a secondary chat with a separate, drifting implementation.
- Allowing secondary-chat actions to navigate or replace the main chat.
- Showing the same thread simultaneously in the main and secondary chats.
- Treating the secondary chat as a nested application with its own sidebar or project navigation.
- Adding mobile support in the first release.
- Requiring multiple simultaneous Chat surfaces in the first release.
- Defining the implementation architecture, file changes, state model, migrations, or test layout
  in this product plan.

## Product-Level Delivery Plan

### 1. Establish a Reusable Chat Experience

Make the existing chat experience usable as both a primary and secondary chat while preserving the
current behavior of the main chat. Confirm that the two roles can intentionally differ only where
the secondary role forbids navigation to another thread.

### 2. Deliver One Independent Chat Surface

Add the thread-menu entry and one secondary Chat surface. Validate independent live work,
composer state, approvals, focus, thread-local commands, main-thread navigation, surface closing,
and unavailable-thread behavior.

### 3. Extend to Multiple Chat Surfaces

Allow more than one secondary Chat surface after the single-surface experience is stable. Preserve
the same independence rules rather than introducing a second model for multiple tabs.

Implementation planning for each stage will be added separately after the product plan is reviewed.

## Acceptance Criteria

- Main thread A and secondary thread B can both be visible and can run work concurrently.
- Sending or interrupting from either chat affects only its displayed thread.
- Draft text and attachments in one composer do not appear in the other.
- Approval and user-input responses are submitted to the correct thread.
- Thread-local shortcuts and commands follow the chat the user is interacting with.
- Navigation-producing actions are unavailable in the secondary chat and cannot redirect the main
  chat accidentally.
- Navigating the main chat away from A leaves secondary thread B open and unchanged.
- A related surface opened from B either uses B's context or is unavailable.
- Closing the Chat surface leaves thread B and its running work untouched.
- Deleting or losing access to B never causes the surface to display a different thread.
- The main chat retains its existing behavior after becoming reusable.
- Web and desktop present the same feature behavior, subject to their existing layout differences.
