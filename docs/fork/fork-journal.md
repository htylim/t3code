# Fork journal

This journal explains why this fork intentionally differs from upstream. Git remains the source of
truth for exact file and line history.

Add an entry for meaningful changes to product behavior, architecture, branding, builds, operations,
or fork policy. Skip mechanical edits and changes that do not alter the fork's relationship with
upstream.

## Entry template

```markdown
## YYYY-MM-DD — Short title

- Upstream baseline: `<commit>`
- Change: What differs from upstream.
- Reason: Why the fork needs the difference.
- Scope: Main files, surfaces, providers, or contracts affected.
- Verification: How the change was checked.
```

## 2026-08-02 — Fork initialized

- Upstream baseline: `e60821f0e`
- Change: Established `fork` as the downstream integration branch and added fork-specific guidance
  and this journal under `docs/fork`.
- Reason: Keep `main` as an upstream mirror while making downstream intent and drift easy to audit.
- Scope: Repository workflow and documentation only; no runtime behavior changed.
- Verification: Confirmed `main` tracks `upstream/main`, `fork` tracks `origin/fork`, and both began
  at the same upstream commit.

## 2026-08-02 — Add Fork desktop identity

- Upstream baseline: `e60821f0e`
- Change: Desktop versions ending in `-fork` or `-fork.<identifier>` package as `T3 Code (Fork)`
  with bundle identifier `com.htylim.t3code.fork`. The desktop branding contract and environment
  identification pill expose the `Fork` stage in the UI. Fork artifacts omit the upstream update
  feed.
- Reason: Keep the fork installed beside T3 Code Nightly and make the active app unmistakable.
- Scope: Desktop packaging and runtime identity, shared desktop branding contracts, web branding,
  sidebar environment identification, and fork build guidance. Production state remains shared at
  `~/.t3/userdata`.
- Verification: Passed 70 focused shared, desktop environment, desktop artifact, web branding, and
  sidebar identification tests, plus targeted lint and type checks. Built the unsigned Apple Silicon
  `0.0.31-fork.1` DMG, verified its disk-image checksum, and confirmed its name, version, and bundle
  identifier from the packaged `Info.plist`.

## 2026-08-02 — Restore Copy Thread ID in Sidebar v2

- Upstream baseline: `e60821f0e`
- Change: Added the missing **Copy Thread ID** action to the Sidebar v2 thread context menu with the
  same clipboard confirmation and failure feedback as the traditional sidebar.
- Reason: Sidebar v2 replaced the traditional sidebar menu without carrying this useful action over.
- Scope: Web and desktop thread context menus rendered by `SidebarV2`.
- Verification: Passed targeted lint and the web type check. In an isolated web environment,
  right-clicked a real Sidebar v2 thread, selected **Copy Thread ID**, observed the success toast,
  and confirmed the clipboard value matched that thread's ID in the isolated database.

## 2026-08-06 — Add native thread forking

- Upstream baseline: `4f5834ba7`
- Change: Added a composer-only `/fork` operation for Codex, Claude Agent, and OpenCode. A fork
  copies the completed visible timeline into an ordinary target thread, creates an independent
  native provider session and checkpoint baseline, and deliberately keeps the source workspace.
  Cursor and Grok remain unsupported. No fork-specific event, projection field, or durable source
  relationship was added.
- Reason: Let users branch a provider conversation at its current head without duplicating or
  isolating the files they are already working on.
- Scope: Shared contracts and client runtime; provider adapters and durable bindings; server
  orchestration, attachments, and checkpointing; web and mobile composers; user and maintainer
  documentation. Desktop inherits the web behavior.
- Verification: Passed the focused Phase 1–4 contract, provider, orchestration, web, and mobile test
  selectors and targeted type, lint, and formatting checks. Phase 5 documentation links and
  formatting were checked explicitly. In an isolated web environment, Codex, Claude Agent, and
  OpenCode each created a native fork with copied history, navigated to the target, and accepted a
  follow-up prompt; the Codex source also accepted a later prompt independently.

## 2026-08-07 — Add Rename Thread keybinding

- Upstream baseline: `a0a7ff840`
- Change: Added the `thread.rename` command with an `F2` default, command-palette entry, and support
  for starting the existing inline rename flow from either web sidebar.
- Reason: Make thread renaming available without opening the thread context menu.
- Scope: Shared keybinding contracts and defaults, web and desktop shortcut handling, both sidebar
  implementations, command palette, and user documentation. Mobile and provider behavior are
  unchanged.
- Verification: Passed 100 focused contract, server backfill, shortcut, Settings, command-palette,
  and rename-dispatch tests; targeted contract, shared, and web type checks; targeted lint and
  formatting checks. In an isolated web environment, confirmed Settings lists **Thread: Rename**
  with `F2`, used `F2` from both sidebar versions, renamed a real thread, and started the same inline
  flow from the command palette.

## 2026-08-08 — Add Sidebar v2 project switching

- Upstream baseline: `4f5834ba7`
- Change: Added the unbound `project.switch` command to Settings and the command palette. A
  configured shortcut opens a searchable logical-project picker; choosing a project opens its
  new-chat draft and scopes Sidebar v2 to that project. The sidebar dropdown remains a pure filter.
- Reason: Make moving between projects a single keyboard-driven action instead of leaving the
  active chat outside the newly selected sidebar scope.
- Scope: Shared keybinding contracts, web and desktop shortcut handling, Settings command discovery,
  command palette, Sidebar v2's existing in-memory scope state, focused tests, and user
  documentation. Mobile, legacy sidebar behavior, server orchestration, providers, and persistence
  are unchanged.
- Verification: Passed 88 focused contract, shortcut, Settings, command-palette, availability,
  switch-composition, scope-bus, and integration tests; targeted contracts and web type checks;
  targeted lint, formatting, and diff checks. In an isolated web environment with two projects,
  assigned the shortcut in Settings, confirmed picker filtering and Escape, and switched in both
  directions. Each selection opened a fresh draft for the chosen project and updated Sidebar v2's
  scope label; the standalone **All projects** filter still changed only the sidebar scope.

## 2026-08-08 — Make Sidebar v2 new chat follow its project filter

- Upstream baseline: `4f5834ba7`
- Change: Moved Sidebar v2's new-chat action beside the project filter and made it scope-aware.
  **All projects** opens the project picker through `chat.new`; a specific filter creates directly
  in that logical project through `chat.newLocal`.
- Reason: Keep the most common sidebar action beside the control that determines its target and
  make the selected filter truthful.
- Scope: Sidebar v2, focused filter-action tests, and user keybinding documentation. Desktop
  inherits the web behavior; the legacy sidebar and mobile are unchanged.
- Verification: Passed all 1,846 web unit tests, the web type check, targeted lint, formatting, and
  diff checks. In an isolated web environment with two projects, confirmed **All projects** opened
  the project picker, then filtered to one project while viewing the other and confirmed the button
  created a fresh draft directly in the filtered project.

## 2026-08-08 — Default permission mode to Auto

- Upstream baseline: `c911fcb78`
- Change: New threads and missing runtime-mode recovery state default to **Auto** instead of **Full
  access**. Unknown Codex runtime modes also fall back to Auto rather than failing open. Existing
  threads and explicit Full-access selections are unchanged.
- Reason: Never grant unrestricted command and filesystem access merely because no permission mode
  was selected or persisted.
- Scope: Shared orchestration contracts, web and mobile defaults, server bootstrap and recovery
  fallbacks, Codex safety mapping, permission-mode documentation, and focused tests. Historical
  persistence migrations remain unchanged.
- Verification: Passed 147 focused contract, server provider, Codex runtime, and web draft-store
  tests; targeted contracts, server, and web type checks; targeted lint, formatting, and diff
  checks.

## 2026-08-08 — Make Cmd+W close right-panel tabs

- Upstream baseline: `4f5834ba7`
- Change: Added `rightPanel.close`, defaulted `Cmd/Ctrl+W` to it while the right panel is open, and
  routed it through the existing surface cleanup. On macOS, **Close Window** remains available from
  the File menu and window controls but no longer owns the `Cmd+W` accelerator.
- Reason: Close the active right-panel tab before the panel itself and never leave the desktop app
  running without a visible window because of an accidental `Cmd+W` press.
- Scope: Shared keybinding contracts and defaults, web shortcut context and right-panel handling,
  the macOS desktop application menu, focused tests, and user keybinding documentation. Server
  orchestration, providers, database persistence, and mobile are unchanged.
- Verification: Passed 116 focused contract, server keybinding, web shortcut and Settings, and
  desktop menu and window tests; affected contracts, shared, server, web, and desktop type checks;
  targeted lint, formatting, and diff checks. In the desktop development app, confirmed that
  `Cmd+W` closes right-panel tabs and the panel without closing the window.
