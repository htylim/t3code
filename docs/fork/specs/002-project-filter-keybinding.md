# Project Filter Keybinding Implementation Plan

## Status

Implemented on 2026-08-07 after approval.

## Overview

Add a keyboard-driven, searchable picker for Sidebar v2's existing project filter. The new
`sidebar.projectFilter` command has no default shortcut. It appears in the command palette and in
Settings' **Add keybinding** command picker, where the user can assign a shortcut. Invoking the
command opens the command palette directly on a list of project scopes. Choosing a project updates
only the sidebar filter; it does not navigate, create a thread, or change the active project.

The existing dropdown remains available for mouse use. Both entry points write the same local
`projectScopeKey` state in `SidebarV2`.

## Desired User Experience

1. A user invokes their configured shortcut, or chooses **Filter sidebar by project...** in the
   command palette.
2. A searchable project-scope picker opens immediately.
3. **All projects** is the first option and clears the current filter.
4. Each remaining option represents the same logical project group shown by Sidebar v2's filter
   dropdown.
5. Typing matches the group's display name plus the names and workspace paths of all projects in
   that group.
6. Enter applies the selected scope and closes the palette. Escape closes it without changing the
   current scope.
7. The sidebar's existing filter label reflects the selection, and its existing selection-clearing
   behavior runs when the scope changes.

## Current State Analysis

- Sidebar v2 already stores the filter as `projectScopeKey: string | null`, derives the selected
  logical project group, resets an invalid scope to **All projects**, and clears selected thread
  rows whenever the scope changes (`apps/web/src/components/SidebarV2.tsx`).
- The filter dropdown is backed by `projectGroups`, so a filter choice represents a logical group,
  including same-project copies across environments, rather than one physical project row
  (`apps/web/src/sidebarProjectGrouping.ts`).
- The command palette already builds the same sorted logical project groups and searchable project
  items for project search and **New thread in...**. Those items already include member project
  names and workspace paths as search terms (`apps/web/src/components/CommandPalette.tsx`).
- Programmatic palette opening supports typed intents for **Add project** and **New thread in...**
  (`apps/web/src/commandPaletteBus.ts`, `apps/web/src/components/CommandPalette.logic.ts`).
- Global shortcut dispatch lives in `apps/web/src/routes/_chat.tsx`. Sidebar v2 state is local to
  `SidebarV2`, so the palette needs a small client-only boundary to apply a chosen scope.
- Settings currently discovers commands from default bindings and commands already present in the
  user's configuration. An unbound command therefore needs the built-in command catalog added to
  the **Add keybinding** picker explicitly.
- Sidebar v2 can be enabled in preferences while not actually mounted. Settings routes deliberately
  render the legacy sidebar, so command availability must follow the mounted surface rather than
  the preference alone.
- `AppSidebarLayout` currently owns the route check that decides whether Sidebar v2 is mounted.
  That decision must become shared logic rather than being reimplemented separately in the command
  palette, where the two checks could drift.

## Fixed Product Decisions

| Area              | Decision                                                             |
| ----------------- | -------------------------------------------------------------------- |
| Command ID        | `sidebar.projectFilter`                                              |
| Default shortcut  | None; the user assigns one in Settings                               |
| Settings exposure | Available in the **Add keybinding** command picker while unassigned  |
| Picker            | Reuse the command palette's searchable submenu UI                    |
| First option      | **All projects**, mapped to `null`                                   |
| Project choices   | One choice per Sidebar v2 logical project group                      |
| Search terms      | Group display name, member project names, and member workspace paths |
| Selection effect  | Change only Sidebar v2's project scope                               |
| Active navigation | Do not navigate or change the active thread/project                  |
| Existing dropdown | Keep it and route both entry points to the same state setter         |
| Scope lifetime    | Preserve the current in-memory lifetime; do not persist the filter   |
| Legacy sidebar    | Unsupported because it has no equivalent project-scope filter        |
| Clients           | Web and desktop; mobile is unchanged                                 |
| Server/providers  | No runtime, backfill, orchestration, database, or provider changes   |

## What We Are Not Doing

- Turning the existing dropdown into a searchable combobox.
- Adding a project filter to the legacy sidebar or mobile navigation.
- Persisting the chosen scope across reloads.
- Changing how projects are grouped, sorted, added, removed, or selected for new threads.
- Navigating to a project's latest thread or creating a thread from this picker.
- Assigning or recommending a default shortcut.
- Adding a new server command, wire contract, or database field.

## Implementation Approach

Keep `projectScopeKey` in `SidebarV2`; moving ephemeral presentation state into a global store would
be needless machinery. Add a tiny typed browser event bus that accepts `string | null`. Sidebar v2
subscribes while mounted and applies requests through the same scope setter used by its dropdown.

Extend the command-palette open intent with `project-filter`. Extract the route-and-preference
predicate that mounts Sidebar v2 from `AppSidebarLayout` into shared pure logic, then use that same
predicate for the sidebar mount, the root command-palette action, and shortcut availability. A
configured shortcut opens the intent only while that predicate is true and at least one logical
project exists. Handle this command before `_chat.tsx`'s existing command-palette-open early return
so it can replace an already-open file picker, content search, or root palette. Ignore repeated
keydown events so holding the shortcut cannot stack duplicate submenu views.

The command palette builds project-filter items from its existing `projectGroups` source rather
than reconstructing grouping rules. Each project item captures the group's stable `projectKey`; the
**All projects** item requests `null`. A root command-palette submenu exposes the same list and
displays the configured shortcut when one is assigned.

The picker must not reuse the existing project actions directly because those actions navigate, and
it must not reuse **New thread in...** actions because those create drafts. Reuse the data and
rendering helpers, but give filter choices their own side effect.

## Phase 1: Command Registration and Settings Discovery

### Tests First

**Files**:

- `packages/contracts/src/keybindings.test.ts`
- `apps/web/src/keybindings.test.ts`
- `apps/web/src/components/settings/KeybindingsSettings.logic.test.ts`

**Coverage**:

- The contract accepts `sidebar.projectFilter`.
- The built-in command catalog exposes `sidebar.projectFilter` without adding it to the default
  bindings.
- Settings labels the command **Sidebar: Project Filter** and includes it in the `+` command picker
  when it has no binding yet.
- After the user adds a binding, normal shortcut resolution resolves `sidebar.projectFilter` and
  respects the user's chosen `when` expression.

### Implementation

**Files**:

- `packages/contracts/src/keybindings.ts`
- `apps/web/src/components/settings/KeybindingsSettings.logic.ts`

**Changes**:

- Register `sidebar.projectFilter` as a static keybinding command.
- Export the existing built-in static command catalog as the single source of truth for Settings.
- Build the Settings `+` command options from that catalog plus configured dynamic script commands,
  so commands without defaults remain assignable.
- Do not add `sidebar.projectFilter` to `DEFAULT_KEYBINDINGS`; no server backfill or migration runs.

## Phase 2: Searchable Picker and Sidebar Scope Dispatch

### Tests First

**Files**:

- New `apps/web/src/components/AppSidebarLayout.logic.test.ts`
- `apps/web/src/components/CommandPalette.logic.test.ts`
- New `apps/web/src/sidebarProjectFilter.logic.test.ts`
- New `apps/web/src/sidebarProjectFilterBus.test.ts`
- New `apps/web/src/sidebarProjectFilter.integration.test.tsx`

**Coverage**:

- The reducer opens a `project-filter` intent from closed state and replaces another overlay mode.
- The shared mount predicate used by `AppSidebarLayout` and the project-filter feature is true only
  when Sidebar v2 is enabled on a non-Settings route.
- Filter availability additionally requires at least one logical project; it is false for Settings,
  the legacy sidebar, and an empty project list.
- A configured shortcut replaces an already-open command-palette surface instead of being ignored.
- Repeated keydown events do not push duplicate project-filter views.
- **All projects** stays first and dispatches `null`.
- Project choices use logical-group keys, not physical project IDs.
- Filtering matches group names, member names, and member paths.
- Selecting a project dispatches its scope key without navigation or thread creation.
- The typed scope bus delivers requests to current subscribers and stops after unsubscribe.
- A focused app-shell integration test exercises the complete configured-shortcut path: open the
  project-filter picker, select a logical project, and observe the mounted Sidebar v2 scope and
  label change. It also confirms selected thread rows are cleared and the active route is unchanged.
- The integration test confirms Escape leaves the existing scope unchanged and that the production
  scope subscriber stops receiving requests after unmount.

### Implementation

**Files**:

- New `apps/web/src/components/AppSidebarLayout.logic.ts`
- `apps/web/src/components/AppSidebarLayout.tsx`
- `apps/web/src/commandPaletteBus.ts`
- `apps/web/src/components/CommandPalette.logic.ts`
- `apps/web/src/components/CommandPalette.tsx`
- New `apps/web/src/sidebarProjectFilter.logic.ts`
- New `apps/web/src/sidebarProjectFilterBus.ts`
- `apps/web/src/components/SidebarV2.tsx`
- `apps/web/src/routes/_chat.tsx`

**Changes**:

- Extract the existing Sidebar v2 route-and-preference mount predicate from `AppSidebarLayout` and
  use it there and in the project-filter availability logic as the single source of truth.
- Add `project-filter` to the typed open detail and reducer intent.
- Add a small pure builder for project-filter action items if needed to keep searchable terms and
  side effects directly testable.
- Build the filter submenu from the command palette's existing sorted `projectGroups`.
- Add the **All projects** action before project actions.
- Add **Filter sidebar by project...** to the root command palette with
  `shortcutCommand: "sidebar.projectFilter"` only while Sidebar v2 is actually mounted and at least
  one logical project exists. An unassigned command simply shows no shortcut hint.
- Handle the configured global command before the existing `isCommandPaletteOpen()` early return,
  opening the `project-filter` intent when the same availability predicate passes. Ignore repeated
  keydown events and prevent the browser event only when the command is handled.
- Subscribe `SidebarV2` to scope requests through a small production helper that can also be mounted
  by the focused integration test. Feed both bus requests and dropdown selections into the same
  local setter.
- Preserve normal command-palette Escape, focus, and close behavior.

## Phase 3: Documentation and Fork Record

### Files

- `docs/user/keybindings.md`
- `docs/fork/fork-journal.md`

### Changes

- Document that the command is unbound by default, how to add it from Settings, the Sidebar v2
  limitation, searchable terms, and the fact that selection filters without navigation.
- Add one fork-journal entry after implementation with the upstream baseline, scope, reason, and
  actual verification results.

## Verification

Run the smallest focused checks after implementation:

- Run `vp test run` for:
  - `packages/contracts/src/keybindings.test.ts`
  - `apps/web/src/keybindings.test.ts`
  - `apps/web/src/components/settings/KeybindingsSettings.logic.test.ts`
  - `apps/web/src/components/AppSidebarLayout.logic.test.ts`
  - `apps/web/src/components/CommandPalette.logic.test.ts`
  - `apps/web/src/sidebarProjectFilter.logic.test.ts`
  - `apps/web/src/sidebarProjectFilterBus.test.ts`
  - `apps/web/src/sidebarProjectFilter.integration.test.tsx`
- Targeted type checks for contracts and web only where changed.
- Targeted lint and formatting for changed files.

Do not run repo-wide checks. Browser verification is not part of the implementation unless the user
explicitly approves it. With approval, use an isolated T3 environment and verify that the command is
initially absent from the binding rows but available through `+`, assign a shortcut, then verify the
shortcut, typing by group/name/path, **All projects**, Enter, Escape, replacement of an already-open
palette surface, the root command-palette action, the Settings-route availability guard, and no
navigation after selection.

## Completion Criteria

- [x] `sidebar.projectFilter` has no default binding and is available from Settings' `+` command
      picker.
- [x] After assignment, the configured shortcut and command-palette action open the searchable
      project-filter picker while Sidebar v2 is mounted.
- [x] The action is unavailable on Settings, with the legacy sidebar, and when there are no logical
      projects.
- [x] Sidebar mounting and project-filter availability share one route-and-preference predicate.
- [x] The configured shortcut can replace another open command-palette surface.
- [x] **All projects** clears the filter and every other item maps to the existing logical group
      scope.
- [x] Search covers group names, member project names, and member workspace paths.
- [x] Selection changes only the sidebar filter and preserves existing selection-clearing behavior.
- [x] A focused integration test proves the shortcut, command palette, scope dispatch, and mounted
      Sidebar v2 work together, including Escape and the no-navigation guarantee.
- [x] Legacy sidebar, mobile, server orchestration, providers, and persistence remain unchanged.
- [x] Focused tests and targeted static checks pass.
- [x] User documentation and the fork journal describe the shipped behavior and actual verification.
