# Project Switch Keybinding Implementation Plan

## Status

Implemented on 2026-08-08 after the original project-filter behavior was reconsidered.

## Overview

Add a keyboard-driven project switch for Sidebar v2. The unbound `project.switch` command appears
in Settings and the command palette. Invoking it opens a searchable logical-project picker.
Choosing a project performs two existing client operations as one user action:

1. Open that logical project's new-chat draft through the same handler used by **Chat: New**.
2. Apply that logical project as Sidebar v2's in-memory project scope.

The sidebar dropdown remains a pure filter and retains **All projects**. The switch picker has no
**All projects** item because a chat cannot be created outside a concrete project.

## Desired User Experience

1. A user invokes their configured shortcut or chooses **Switch project...** in the command palette.
2. A searchable list of logical projects opens immediately.
3. Typing matches the logical-project name plus member project names and workspace paths.
4. Choosing a project opens its existing new-chat draft flow and filters Sidebar v2 to the same
   logical project.
5. The selected project scope clears any multi-selected thread rows through Sidebar v2's existing
   scope-change behavior.
6. Escape closes the picker without creating a draft or changing the filter.

## Product Decisions

| Decision                     | Result                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| Command ID                   | `project.switch`                                            |
| Default shortcut             | None                                                        |
| Settings label               | **Project: Switch**                                         |
| Command-palette label        | **Switch project...**                                       |
| Picker rows                  | One per logical project; no **All projects** row            |
| Search terms                 | Logical name, member names, and member workspace paths      |
| New-chat behavior            | Reuse the existing `useHandleNewThread` path                |
| Sidebar behavior             | Apply the selected logical group's existing in-memory scope |
| Availability                 | Sidebar v2 mounted with at least two logical projects       |
| Existing dropdown            | Keep as an independent pure filter                          |
| Legacy sidebar/mobile        | Unchanged                                                   |
| Server/providers/persistence | Unchanged                                                   |

## Architecture

The command is separate from both `chat.new` and the sidebar dropdown because its semantics are a
composition of the two. Commands are not dispatched into one another. The command-palette item
calls the underlying new-thread handler and, once that succeeds, sends the selected logical scope
to Sidebar v2 through the existing typed scope bus.

The picker reuses the command palette's existing `projectGroups`,
`buildSidebarProjectPickerEntries`, and project action builder. This preserves current behavior for
logical projects containing multiple physical projects or environments. The current physical
member remains preferred when it belongs to the selected logical group; otherwise the group's
representative project is used.

The scope request follows successful draft navigation. If draft creation fails, the sidebar filter
does not partially change. Sidebar scope remains presentation state owned by `SidebarV2`; moving it
into durable or global state would add machinery without improving this feature.

## Implementation Scope

### Contracts and Settings

- Register `project.switch` in the static keybinding command catalog.
- Leave it out of default bindings.
- Expose it through Settings' **+** command picker as **Project: Switch**.

### Web and Desktop

- Add a `project-switch` command-palette open intent.
- Resolve the configured shortcut before the existing open-palette guard so it can replace another
  palette surface.
- Require Sidebar v2 and at least two logical projects.
- Build switch rows from the same logical-project picker entries as **New thread in...**.
- Start the selected project's draft and then apply its logical sidebar scope.
- Keep the Sidebar v2 dropdown and `projectScopeKey` ownership unchanged.

Desktop inherits the web behavior. The legacy sidebar and mobile remain unchanged because neither
has Sidebar v2's logical-project filter.

### Tests

Focused coverage proves:

- The contract accepts `project.switch` and it remains unbound by default.
- Settings discovers and labels the command.
- Shortcut resolution respects the configured `when` expression.
- Availability requires Sidebar v2, a chat route, and at least two logical projects.
- Repeated shortcuts are ignored and the picker can replace another palette surface.
- The palette reducer carries the `project-switch` intent.
- Switching starts the draft before applying scope and does not apply scope after a failed start.
- The configured-shortcut integration path results in both a new-chat call and the matching sidebar
  scope, including existing selection clearing and scope-label behavior.
- The standalone scope bus and sidebar filter label still behave correctly.

## Verification

Run the smallest focused checks:

- `packages/contracts/src/keybindings.test.ts`
- `apps/web/src/keybindings.test.ts`
- `apps/web/src/components/settings/KeybindingsSettings.logic.test.ts`
- `apps/web/src/components/AppSidebarLayout.logic.test.ts`
- `apps/web/src/components/CommandPalette.logic.test.ts`
- `apps/web/src/projectSwitch.logic.test.ts`
- `apps/web/src/projectSwitch.integration.test.tsx`
- `apps/web/src/sidebarProjectFilter.logic.test.ts`
- `apps/web/src/sidebarProjectFilterBus.test.ts`
- Targeted contracts and web type checks, lint, formatting, and `git diff --check`.

Browser verification is optional and requires explicit approval. If requested, use an isolated T3
environment and verify shortcut assignment, name/path search, keyboard selection, Escape, overlay
replacement, Settings-route guarding, draft navigation, scope-label updates, and **All projects**
from the standalone sidebar dropdown.

## Completion Criteria

- [x] `project.switch` is assignable but unbound by default.
- [x] The shortcut and command-palette action open the logical-project picker.
- [x] The action is unavailable without Sidebar v2 or another logical project.
- [x] The picker has project rows only and retains existing logical grouping/search behavior.
- [x] Selection uses the existing new-chat path and then applies the matching sidebar scope.
- [x] Failed draft creation does not partially change the sidebar scope.
- [x] The sidebar dropdown remains an independent filter with **All projects**.
- [x] Legacy sidebar, mobile, server orchestration, providers, and persistence remain unchanged.
- [x] Focused automated verification passes.
