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

## 2026-08-08 — Add thread forking to sidebar menus

- Upstream baseline: `4f5834ba7`
- Change: Added **Fork this thread** to both web sidebar thread context menus when the existing
  thread-fork eligibility rules allow it. The action reuses the existing fork operation and opens
  the new thread on success.
- Reason: Make thread forking available directly from the thread being acted on instead of requiring
  users to open it and submit `/fork` in the composer.
- Scope: Legacy and Sidebar v2 context menus, user documentation, and desktop through its shared web
  UI. Server orchestration, providers, contracts, persistence, and mobile are unchanged.
- Verification: Passed 65 focused shared, client-runtime, and web fork tests, the web type check,
  targeted lint and formatting checks, and the final diff check. In an isolated web environment,
  right-clicked a completed Claude Agent thread in both Sidebar v2 and the legacy sidebar. Each
  menu created a new native fork, copied the visible conversation, and navigated to a distinct
  target thread.

## 2026-08-09 — Add agent thread control through MCP

- Upstream baseline: `4f5834ba7`
- Change: Added eleven provider-scoped MCP tools for local context and model discovery, lightweight
  thread listing/status/waits, bounded persisted reads, thread creation and follow-ups,
  interruption, reversible updates, and explicit approval or user-input responses. Existing
  workspaces and Git worktrees are accepted only after read-only identity validation.
- Reason: Let an agent coordinate ordinary T3 threads in its own environment without adding a
  workflow engine, durable lineage, transcript polling, or worktree management.
- Scope: Server MCP implementation, tests, and the existing MCP capability, credential, and toolkit
  registration points. Codex, Claude Agent, Cursor, Grok, and OpenCode use the same existing
  orchestration commands; contracts, persistence, projections, provider adapters, WebSocket paths,
  and web, desktop, and mobile clients are unchanged.
- Verification: Passed 83 focused MCP thread-control, toolkit, output, status, provider-validation,
  HTTP, authentication, and credential tests, including a local projection integration case and
  identical start-command routing for all five providers. Also passed the targeted server type
  check, lint and formatting checks for every changed file, and `git diff --check`.
- Maintenance note: MCP's `apps/server/src/mcp/toolkits/threadControl/status.ts` intentionally
  mirrors queued-turn and effective-snooze lifecycle rules found in
  `packages/client-runtime/src/state/threadSettled.ts` and
  `apps/server/src/orchestration/decider.ts`. This duplication keeps fork-only MCP code isolated
  from upstream-owned lifecycle modules. When either upstream implementation changes, review and
  update the MCP status rules and their focused tests to keep all three consistent.

## 2026-08-09 — Isolate fork release builds from source branches

- Upstream baseline: `4f5834ba7`
- Change: Fork releases now build from the explicitly selected source commit in a disposable
  detached worktree. The release procedure aligns package, client, and Electron versions, verifies
  the compiled server and client versions independently, and forbids moving `fork` when another
  source branch was requested.
- Reason: Setting only the web and Electron build versions produced an artifact whose
  `0.0.31-fork.4` client connected to a bundled server reporting `0.0.31`. Preparing that release
  also moved the local `fork` branch even though a feature branch was the requested source.
- Scope: Fork desktop release policy and manual build instructions only. Runtime code and the
  upstream release workflow are unchanged.
- Verification: Reviewed the documented version sources against the server, web, packaging, and
  upstream release scripts; checked the Markdown diff and command sequence explicitly.

## 2026-08-09 — Bound MCP thread-control authority

- Upstream baseline: `4f5834ba7`
- Change: Provider-scoped MCP credentials now carry their provider session's runtime-mode ceiling
  and an in-memory set of child threads they created. Child creation is limited to the calling
  project and exact workspace; later mutations require a credential-owned child; start, send, and
  runtime-mode updates cannot exceed the ceiling. Removed agent-side approval and structured
  user-input responses from the v1 toolkit, leaving ten thread-control tools.
- Reason: A supervised agent could previously grant itself Full access through another thread,
  mutate any known thread, or accept the approval intended to constrain it.
- Scope: MCP invocation authority, credential issuance and child grants, thread-control mutation
  validation and schemas, provider-session credential setup, focused tests, and the MCP product
  specification. Persistence, orchestration contracts, provider adapters, and clients are
  unchanged.
- Verification: Passed all 115 MCP tests and 33 focused ProviderService tests, the targeted server
  type check, targeted lint and formatting checks, and `git diff --check`.

## 2026-08-09 — Make MCP thread waits transition-aware

- Upstream baseline: `4f5834ba7`
- Change: Cursor-based `threads_wait` renewals now replay at most 1,000 existing orchestration
  events, immediately reduce them to watched-thread signals, silently catch up past unrelated
  activity, and match only threads with a relevant transition after the supplied cursor. Ahead or
  excessively stale cursors still resynchronize from current lightweight status.
- Reason: A global cursor previously made unrelated multi-agent activity interrupt waits, while an
  already-completed thread matched immediately on every renewal of the same group.
- Scope: MCP thread-control implementation, schemas, focused tests, and this fork specification.
  Orchestration, persistence, shared contracts, provider adapters, and clients are unchanged.
- Verification: Passed all 118 focused MCP tests, the targeted server type check, targeted lint
  and formatting checks, and `git diff --check`.

## 2026-08-10 — Release Codex writers after native forks

- Upstream baseline: `90feb48c0`
- Change: A successful Codex native fork now closes the source app-server before the target can be
  resumed in its own T3 session. Fork eligibility also rejects sources with working or monitored
  background agents. Failed native forks leave the source process active. Other providers are
  unchanged.
- Reason: Codex loads the forked native thread into the source app-server and keeps its exclusive
  writer. Starting the target's separate app-server then failed with `already has an active writer`.
  Separate processes are required because each T3 thread has its own MCP credential and
  thread-control scope.
- Scope: Codex adapter lifecycle, fork eligibility and authoritative snapshot checks, focused
  regression tests, user guidance, and the fork-only writer-release specification. Provider
  contracts, orchestration events, persistence, and non-Codex adapters are unchanged.
- Verification: Passed 128 focused Codex runtime, adapter, provider-service, eligibility, fork
  service, and snapshot tests; server and shared type checks; targeted lint for every changed
  TypeScript file except `ThreadForkService.test.ts`; formatting for every changed file; and
  `git diff --check`. That test file retains two pre-existing manual Effect runtime lint violations
  outside the changed lines. In an isolated web environment, a Codex source completed, `/fork`
  created a distinct target that accepted a follow-up, and the source then accepted another
  follow-up without an active-writer error. See
  `docs/fork/specs/005-codex-fork-writer-release.md` for the design.
