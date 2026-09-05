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

## 2026-09-05 - Scope thread references and support multiword queries

- Upstream baseline: `163d86a78`
- Change: `%` searches the composing project; `%%` searches all projects in the current environment.
  Both lists sort by latest user activity, with creation time as the fallback. Spaces continue a
  query, selection replaces it, and Escape leaves its text intact while keeping it dismissed during
  further editing. A fresh trigger opens a new query. Enter with no matches keeps the picker open.
- Reason: Unrelated projects crowded out relevant threads, and whitespace prevented searching
  multiword titles.
- Scope: Web and desktop main and side-chat composers, thread-reference filtering, and user guidance.
  Native mobile, contracts, server queries, and provider adapters are unchanged.
- Verification: 150 focused trigger, dismissal, replacement, picker, editor, and inline-token tests
  passed, along with the web typecheck, targeted lint (existing warnings), formatting, and whitespace
  checks. In an isolated browser with copied thread data, verified project scope after switching
  draft projects and in a side chat belonging to a different project than the main chat. Confirmed
  environment-wide ordering against SQLite, multiword queries, Enter/Tab selection, Escape followed
  by continued typing, fresh triggers, current-thread exclusion, and Enter with no matches.

## 2026-09-05 - Manage worktrees from the workspace picker

- Upstream baseline: `163d86a78`
- Change: Web and desktop share a workspace menu listing local worktrees with busy or dirty status.
  Row menus support inline directory rename, path copy, desktop reveal, and confirmed removal.
  The menu fetches only checked-out local refs, retains selection indicators, and stays open after
  rename. Removal warnings report no upstream instead of treating default-branch distance as unpushed commits.
  Rename updates settled and archived thread paths. Running worktrees cannot be removed, and the
  current worktree cannot be renamed or removed.
  The picker retains the previous static label once a thread has messages, an active session, or
  an assigned worktree on a saved thread.
- Reason: Reuse and manage existing worktrees without hunting through branches or leaving the composer.
- Scope: Wide and narrow web composer menus, an additive rename RPC, desktop shell reveal, and
  optional confirmation labels and details, and a worktree-only ref query. Native mobile and provider
  adapters are unchanged.
- Verification: 146 focused toolbar, confirmation, and Git driver tests passed, along with web,
  server, contracts, client-runtime, and desktop type checks. An isolated seeded dev server verified
  listing, dirty and busy labels, running restrictions, nested menus, right-click, copying, rename
  errors and success, settled and archived path updates, and clean and forced removal. Regression
  checks cover no-upstream warning text, a worktree-only query without pagination, restored radio
  selection, and rename leaving the menu open.

## 2026-09-04 - Merge upstream browser, usage, terminal, and provider changes

- Upstream baseline: `163d86a78`
- Change: Merged upstream's 174 commits while retaining native thread forking, bounded MCP thread
  control, side chats and transient context, thread references, Mermaid rendering, timeline
  bookmarks and prompt navigation, Sidebar v2 project filtering and user-activity sorting, the Auto
  permission default, and fork desktop identity and update rules. Adopted upstream's orchestration
  replay and runtime-context queries, provider compaction and analytics, Markdown renderer changes,
  browser import, usage-limit reporting, and terminal work.
- Reason: Upstream changed the orchestration, provider-session, composer, Markdown, sidebar,
  desktop, and mobile seams extended by the fork. A direct conflict choice would have dropped either
  downstream behavior or upstream's newer contracts.
- Scope: Server orchestration and providers; web and mobile composers; Markdown, side-chat, sidebar,
  and keybinding UI; desktop browser support; shared contracts; dependencies; and documentation.
- Verification: Passed 790 focused server, web, mobile, contracts, shared, and client-runtime tests
  plus the server, web, mobile, contracts, and shared package type checks. Refreshed dependencies
  with the merged lockfile, which passed the
  repository supply-chain policy check. Also ran targeted formatting, conflict-marker checks, and
  whitespace checks. The only reported whitespace is three payload lines in upstream's
  `react-native-screens` patch.

## 2026-09-04 - Keep side-chat composer styling aligned with upstream

- Upstream baseline: `fff33f9e8519`
- Change: The fork-owned side chat now wraps the shared `ChatComposer` with upstream's
  `ComposerSurface.Shell` and `ComposerSurface.Host` components.
- Reason: Upstream moved the composer backdrop, outline, radius, and shadow out of global
  `.chat-composer-glass-*` classes and into `ComposerSurface`. The side-chat adapter kept the
  removed class names, so its controls rendered without the composer container.
- Scope: Web and desktop side chats and the focused presentation-parity test. Mobile and the
  upstream main composer are unchanged.
- Verification: Passed 11 focused side-chat tests, targeted formatting, targeted lint with no
  errors, and `git diff --check` for the changed files. In an isolated browser with synthetic
  threads, opened the target in the side surface and typed into its composer. The side composer
  retained upstream's 1px outline, 22px corners, translucent backdrop, and light-mode shadow in
  both light and dark appearances.

## 2026-09-03 - Sort active threads by user activity

- Upstream baseline: `fff33f9e8`
- Change: Web, desktop, and mobile sort active threads by their latest user message, with creation
  time as the fallback. Agent progress and lifecycle changes do not move rows.
- Reason: The sidebar should match the activity age shown on each row. Treating an un-settle stamp
  as activity put 3d and 4d threads above a thread with a message from minutes ago.
- Scope: Shared active-thread ordering, web and mobile sidebar tests, and user documentation.
- Verification: Passed 159 focused web, mobile, and shared-runtime tests; affected package type
  checks; targeted lint and formatting; and `git diff --check`. An isolated dev app using the
  reported thread data placed the minutes-old thread above every 3d and 4d thread.

## 2026-09-03 - Merge upstream assistant citations, attachments, and desktop changes

- Upstream baseline: `fff33f9e8`
- Change: Merged upstream's 276 commits while retaining native thread forking, MCP thread control,
  side chats and transient context, thread references, Mermaid rendering, timeline bookmarks, prompt
  navigation, Sidebar v2 project filtering, the Auto permission default, and fork desktop identity
  and update rules. `Cmd/Ctrl+W` now follows upstream's terminal and right-panel close behavior, then
  falls back to `thread.settleAndNew` when neither panel is open. **Ask in side chat** now sends an
  assistant citation token for assistant-message selections, with the old blockquote prompt kept as
  the fallback for selections that cannot be cited.
- Reason: Upstream added first-class assistant citations and changed the composer, provider,
  attachment, timeline, desktop, and mobile seams extended by this fork. Taking either side whole
  would lose fork features or skip upstream's newer behavior.
- Scope: Contracts, orchestration, provider capabilities and session handling, web and mobile
  composers, side chats, Markdown, timeline state, keybindings, Sidebar v2, desktop, and dependency
  metadata.
- Verification: Passed 699 focused contract, shared, server, web, and mobile tests, then reran a
  400-test integration subset after the final dependency install. Passed affected package type
  checks, targeted lint with no errors, targeted formatting, frozen-lockfile installation, and
  conflict-marker checks. Started the full web and server stack against the repository-local `.t3`
  state, received HTTP 200 from the web client, and confirmed the server responded before stopping
  the captured process.

## 2026-08-30 - Keep settled threads anchored to their last message

- Upstream baseline: `acb599d2dc5b`
- Change: The default web and desktop sidebar now labels and sorts settled threads by their last
  user message, with creation time as the fallback for threads without one.
- Reason: Upstream changed a row's timestamp from conversation age to settlement age when the user
  settled it, so old threads suddenly read `now` despite receiving no new prompt.
- Scope: Default web and desktop sidebar ordering, focused tests, and user documentation. The
  legacy sidebar, mobile, server lifecycle metadata, contracts, providers, and persistence are
  unchanged.
- Verification: Passed 108 focused sidebar tests, the web type check, targeted lint and formatting,
  and `git diff --check`. In an isolated web environment, manually settled a seven-day-old thread.
  The server stamped its settlement as current, while the sidebar kept the `7d` label and sorted it
  below a settled thread whose last message was 21 hours old.

## 2026-08-29 - Keep prompt navigation on the minimap cursor

- Upstream baseline: `acb599d2dc5b`
- Change: The web timeline minimap now handles prompt-navigation keybinding actions through the
  same item selection used by clicks. Previous and next move through prompt indices instead of
  reconstructing the selected prompt from scroll pixels.
- Reason: The pixel lookup omitted the list header offset, so every settled key press selected the
  same prompt again and users had to repeat the shortcut.
- Scope: Web and desktop main timelines and side chats. Mobile, providers, server orchestration,
  contracts, stored messages, and keybinding defaults are unchanged.
- Verification: Passed 88 focused timeline tests, the web type check, targeted lint and formatting,
  and `git diff --check`. In an isolated web client, six-prompt navigation passed consecutive and
  rapid previous/next actions, first/last and boundary actions, manual-scroll re-anchoring, minimap
  clicks, and main-versus-side-chat focus ownership.

## 2026-08-28 - Follow Chat: New project selection in a filtered sidebar

- Upstream baseline: `eafbc4e216e1`
- Change: When **Chat: New** opens the project picker while Sidebar v2 has a project filter, the
  selected project becomes the new filter after its draft opens. **All projects** remains selected
  when no filter was active.
- Reason: A draft created in another project was immediately hidden by the previous sidebar filter.
- Scope: The existing fork-owned Sidebar v2 filter bus, the web command palette, focused tests, and
  user documentation. Desktop inherits the web behavior. Legacy sidebar, mobile, server,
  contracts, providers, and persistence are unchanged.
- Verification: Passed 30 focused filter, project-switch, and command-palette tests; the web type
  check; targeted lint and formatting; and `git diff --check`. In an isolated web environment with
  two projects, **Chat: New** kept **All projects** selected when it was already active, then moved
  an active `t3code` filter to `t3code-filter-project` after opening that project's draft.

## 2026-08-28 - Add unbound prompt navigation actions

- Upstream baseline: `3283bffbdc01`
- Change: Added keybinding actions for moving to the previous, next, first, or last loaded user
  prompt. The actions have no default shortcuts. Main chats and focused side chats navigate their
  own timelines.
- Reason: Make long conversations keyboard-navigable without choosing shortcuts for the user or
  conflicting with operating-system and editor bindings.
- Scope: Shared keybinding contracts, web and desktop timeline navigation, focused tests, and user
  documentation. Mobile, providers, server orchestration, and stored message contracts are
  unchanged.
- Verification: Passed 68 focused tests, affected package type checks, targeted lint and format
  checks, and an isolated browser pass covering all four actions plus main and side-chat focus
  ownership.

## 2026-08-28 - Settle and replace the active chat with Cmd+W

- Upstream baseline: `acb599d2dc5b`
- Change: Added `thread.settleAndNew`, defaulted `Cmd/Ctrl+W` to it when neither the terminal nor
  right panel is open, and waits for settlement before opening a fresh draft in the same project.
- Reason: Make closing a finished chat behave like closing a tab without weakening the existing
  terminal and right-panel close shortcuts.
- Scope: Shared keybinding contracts and defaults, web and desktop shortcut handling, focused
  tests, and user documentation. Mobile, providers, and server orchestration are unchanged.
- Verification: Passed 94 focused contract, server-default, and web shortcut tests; affected
  contracts, shared, server, and web type checks; targeted lint and formatting; and `git diff
--check`. In an isolated web environment, pressed `Cmd+W` on an unsettled thread with both panels
  closed, confirmed the source moved to the Settled shelf, and landed on a fresh same-project draft.

## 2026-08-28 - Merge upstream attachment, feedback, and packaging changes

- Upstream baseline: `acb599d2dc5b`
- Change: Merged upstream's 112 commits while retaining native thread forking, side chats, thread
  references, downstream desktop identity, T3 Connect source-build defaults, and the Auto permission
  default. Side chats now use upstream's attachment upload queue with the legacy inline-image path
  kept for older servers. Manual context compaction remains disabled in side chats because that
  surface has no compaction lifecycle. Codex keeps both native session forking and upstream feedback
  upload support. Fork desktop builds remain excluded from upstream and preview update feeds. The
  merged server entrypoint canonicalizes both sides of npm and npx symlinks so macOS path aliases do
  not prevent the CLI from starting.
- Reason: Upstream changed the composer contract, attachment ownership, Codex runtime API, Markdown
  processing, and desktop packaging in code also extended by the fork. Taking either side whole
  would drop behavior or leak uploaded attachment files after failed dispatches.
- Scope: Contracts and environment capabilities; HTTP and WebSocket orchestration dispatch;
  provider routing and Codex runtime; web and mobile composers; side chats; Markdown rendering;
  server entrypoint and provider cache compatibility; desktop artifact configuration and tests;
  provider documentation.
- Verification: Passed the complete contracts, shared, client-runtime, web, and server test matrix
  with 7,326 tests passing and 10 skipped, plus merge-focused desktop packaging tests. Passed all
  affected type checks, production web and server builds, frozen-lockfile validation, targeted
  formatting and lint, and `git diff --check`. In an isolated web environment, verified native
  thread forking and independent source follow-up, main and side-chat attachment uploads, Mermaid
  rendering and controls, thread-reference chips, and side-chat composition.

## 2026-08-22 — Merge upstream without disabling thread control

- Upstream baseline: `2c4158f87a1b`
- Change: Merged upstream's 113 commits. The new agent-browser setting now removes only the MCP
  preview capability and browser instructions; fork-owned thread-control credentials and guidance
  remain available. Adopted upstream's first-message anchoring and follow-up scrolling while
  retaining fork reading-position bookmarks and clearing them on send.
- Reason: Upstream gated its browser-only MCP server by withholding the whole credential, but this
  fork also uses that credential for bounded thread control. A direct merge would have disabled an
  unrelated fork feature. Upstream's follow-up scrolling fix is preferable to the old all-message
  anchoring behavior and does not conflict with restoring a saved reading position.
- Scope: MCP credential capabilities, provider-session setup, Codex developer instructions,
  orchestration dispatch integration, web composer and timeline seams, and upstream test doubles
  updated for native thread forking.
- Verification: Passed focused contracts, MCP, orchestration, provider, Codex, composer, timeline,
  and bookmark tests, plus affected contracts, shared, client-runtime, server, and web type checks,
  targeted formatting and lint, and `git diff --check`.

## 2026-08-17 — Focus side chats when opened

- Upstream baseline: `a5e29edeec`
- Change: Opening a side chat now moves keyboard focus from the main composer to the side-chat
  composer after its target thread loads.
- Reason: The side surface became visible while the main composer kept the caret, so typing still
  went to the main chat.
- Scope: The fork-owned side-chat adapter and its focused presentation test. Desktop inherits the
  web behavior. Mobile and other right-panel surfaces are unchanged.
- Verification: Passed 11 focused side-chat tests, the web type check, targeted lint and formatting,
  and `git diff --check`. In the isolated dev app, opened Chat from the right-panel picker and
  confirmed the side composer became `document.activeElement` while the main composer lost focus.

## 2026-08-17 — Enable T3 Connect in Fork desktop artifacts

- Upstream baseline: `a5e29edeec`
- Change: Fork desktop packaging now uses `.env.example` as the lowest-precedence source for public
  T3 Connect build configuration. Ordinary upstream-identity builds and unconfigured development
  clones remain cloud-disabled.
- Reason: Disposable fork release worktrees do not contain ignored `.env` files, so previous Fork
  artifacts silently omitted T3 Connect even though the source supports it.
- Scope: Public configuration loading, desktop artifact source-build environment, focused tests,
  and fork release guidance.
- Verification: Focused public-config and desktop artifact tests, plus targeted formatting, lint,
  and type checks.

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

## 2026-08-11 — Add thread reference picker

- Upstream baseline: `9821bca1c`
- Change: Added a web and desktop `%` composer picker backed by already-loaded thread shells. It
  inserts canonical `t3code://threads/<environment>/<thread>` Markdown, renders sent references as
  same-origin thread chips, and teaches the provider-neutral `thread_status` and `thread_read` MCP
  metadata how to validate and read them on demand.
- Reason: Make it easy to point an agent or another user at an existing T3 conversation without
  adding transcript injection, message attachments, or new persisted state.
- Scope: Fork-owned URI parsing, picker ranking, chip presentation, and focused tests; narrow web
  composer, command-menu, Markdown sanitizer/renderer, and CSS seams; thread-control MCP tool
  descriptions; user documentation. Desktop inherits web behavior. Native mobile, contracts,
  persistence, provider adapters, server queries, and desktop deep-link lifecycle are unchanged.
- Verification: Passed 90 focused URI, picker, composer trigger/replacement, rendered-link,
  Markdown safety, and MCP metadata tests; web and server type checks; targeted lint and formatting;
  and `git diff --check`. In an isolated web environment, confirmed bare and filtered `%` results,
  current-thread and archive exclusion, draft-route inclusion, keyboard selection into raw Markdown,
  inert malformed links, same-origin chip navigation and copy metadata, the missing-target fallback,
  and an embedded `100%` expression that did not open the picker.
- Upstream conflict map: In `composer-logic.ts`, reapply only the web-local `thread` trigger kind
  and `%` token branch at the current trigger source of truth. In `ChatComposer.tsx`, preserve
  upstream state and reconnect shell snapshots, thread items, and selection replacement at the
  current menu seams. In `ComposerCommandMenu.tsx`, port the `thread` item, icon, and **Threads**
  group to any replacement menu instead of restoring old JSX.
- Upstream conflict map: In `ChatMarkdown.tsx`, preserve upstream sanitizer, file-link, and external
  link behavior, then reapply the canonical `t3code:` allow-list, the sanitized original-href marker
  used to make malformed raw or Markdown links inert, and the early internal-chip branch. Keep the
  rendered DOM link on the same-origin route. The adjacent `index.css` change only excludes thread
  chips from ordinary link decoration and adds their focus treatment.
- Upstream conflict map: `apps/server/src/mcp/toolkits/threadControl/` and the new
  `threadReference.ts` and `ThreadReferenceLink.tsx` modules are fork-owned. If upstream ships an
  equivalent feature, prefer its URI/parser/navigation model and remove redundant fork machinery
  after verifying `%` selection and provider recognition. Do not resolve conflicts by adding
  attachments, orchestration schemas, database fields, native mobile tokens, provider prompt
  rewriting, automatic reads, or external desktop protocol handling.

## 2026-08-11 — Render thread references as composer chips

- Upstream baseline: `9821bca1c`
- Change: Canonical `[title](t3code://threads/<environment>/<thread>)` references now render as
  atomic, non-navigating chips in the web composer. Their Lexical node still serializes to the exact
  canonical Markdown, so drafts, clipboard text, submissions, and provider prompts keep the same
  representation. Sent-message thread chips remain navigable.
- Reason: `%` selection previously exposed its Markdown implementation in the draft even though
  `@` files and `$` skills render as compact composer chips.
- Scope: The fork-owned thread-reference parser and composer node; narrow integration seams in the
  web prompt segmenter, collapsed/expanded cursor mapping, and Lexical node registration. Desktop
  inherits the web UI. Mobile, shared token parsing, contracts, persistence, server orchestration,
  providers, and sent-message rendering are unchanged.
- Verification: Passed 104 focused thread-reference, composer-segmentation, cursor-mapping, and
  Lexical-node tests; the web type check; targeted lint and formatting; and `git diff --check`. In
  an isolated web environment with realistic thread shells, selected a `%` result and confirmed it
  rendered as one non-editable, non-navigating chip, accepted trailing text, and survived a draft
  reload without exposing the stored Markdown.
- Upstream conflict map: `ComposerThreadReferenceNode.tsx` is fork-owned and contains the chip UI
  and Markdown serialization. In `composer-editor-mentions.ts`, preserve the `thread` segment and
  merge `collectThreadReferenceMarkdownTokens` results with existing inline tokens, sorting an
  enclosing thread reference before token-like text in its title. In `composer-logic.ts`, treat
  `thread` like `mention` for one-unit collapsed cursor mapping. In `ComposerPromptEditor.tsx`,
  preserve only the node import, inline-token predicate entry, segment-to-node creation, and Lexical
  node registration. `threadReference.ts` remains the single URI and Markdown validation source.
  If upstream replaces the composer or ships equivalent thread tokens, port these invariants to its
  native token model instead of preserving the current Lexical plumbing.

## 2026-08-11 — Start a new thread from selected chat text

- Upstream baseline: `9821bca1c`
- Change: Web and desktop users can select rendered text within one chat message, right-click, and
  choose **Ask in new thread**. The new same-project draft is prefilled with a Markdown quote and a
  canonical reference to the source thread but is not sent automatically.
- Reason: Make focused follow-up conversations easy without copying whole transcripts, creating
  selection-specific persistence, or losing the durable source-thread identity.
- Scope: A fork-owned selection surface, prompt builder, and focused tests; one narrow wrapper seam
  in `ChatView.tsx`; thread-reference user guidance. Mobile, contracts, persistence, server
  orchestration, providers, and desktop IPC are unchanged.
- Verification: Passed 32 focused selected-text and thread-reference tests, the web type check,
  targeted lint and formatting, and `git diff --check`. In an isolated web environment, selected
  an assistant response, opened the context action, and confirmed it created a distinct unsent
  draft with one source-thread chip and both selected lines preserved as Markdown quotes.
- Upstream conflict map: `selectedTextThreadAction.ts` and
  `AskInNewThreadSelectionSurface.tsx` own the feature. In `ChatView.tsx`, preserve only the wrapper
  around the existing messages area and its active thread/project/new-thread inputs. If upstream
  ships an equivalent selection action, remove the wrapper and fork-owned files rather than
  merging both implementations. Do not add attachment schemas, message offsets, or server state to
  retain this behavior.

## 2026-08-11 — Add compact Chat right-panel surface

- Upstream baseline: `2e381a50ad`
- Change: Web and desktop thread context menus can open one different existing thread in the
  owning thread's right panel. The fork-owned compact surface shows the target's live timeline,
  persists a plain-text target-scoped draft, and supports direct send, interrupt, approvals, and
  user-input responses without navigating the main chat.
- Reason: Let users monitor and continue a second thread while keeping the primary thread in view,
  without cloning or refactoring upstream's full Chat surface.
- Scope: Fork-owned compact Chat UI and target-command builders; narrow right-panel descriptor,
  tab, sidebar-menu, render, and global-shortcut seams; user documentation. Desktop inherits the
  shared web behavior. Mobile, contracts, server orchestration, providers, related right-panel
  surfaces, and global panel lifetime are unchanged.
- Verification: Passed 45 focused right-panel, menu, target-isolation, availability, and shortcut
  tests; the web type check; targeted lint and formatting; and `git diff --check`. Browser testing
  was not run because it was not requested.
- Upstream conflict map: `components/compact-chat/` is fork-owned. In `rightPanelStore.ts`, preserve
  only the `chat` descriptor, one-per-owner replacement, self-target guard, and migration
  validation. In both sidebars, preserve only the eligible context-menu action. In `ChatView.tsx`,
  preserve the explicit-target render branch and compact-origin shortcut filter. In
  `RightPanelTabs.tsx`, preserve the Chat icon and target-title leaf subscription. If upstream
  ships a target-aware secondary chat, prefer it and remove the fork surface rather than merging
  full-chat behavior into this compact implementation.

## 2026-08-12 — Add blank side-chat creation

- Upstream baseline: `2e381a50ad`
- Change: Renamed the thread-menu action to **Open in side surface** and added `chat.newSide`,
  defaulting to `mod+t`, which creates a blank right-panel chat from either a saved main thread or
  its local draft. The right-panel surface controls expose the same action, and selected main-chat
  text can create a prefilled side chat through **Ask in side chat**. Replacing an existing side
  target requires confirmation; reopening the same target does not. The side-chat composer also
  supports the main composer's `%` thread, `$` skill, and `@` file or folder reference pickers.
  Repeating `mod+t` while the Chat surface is visible closes it instead of creating a replacement.
- Reason: Make a side chat useful before another thread exists and make the action reachable from
  a configurable keyboard shortcut.
- Scope: Shared keybinding contracts and defaults, draft-aware right-panel ownership in both web
  sidebars, blank and selected-text thread creation from `ChatView`, right-panel surface controls,
  focused tests, and user documentation. The new thread snapshots the main chat's project, model
  options, runtime/permission mode, interaction mode, branch, and worktree. Server orchestration,
  provider adapters, desktop-specific code, and mobile remain unchanged.
- Verification: Passed 150 focused contract, server keybinding, web keybinding, routing, menu,
  right-panel, and compact Chat tests for the initial implementation, then 43 focused selected-text,
  right-panel, and compact Chat tests after adding the new entry points, plus 47 focused replacement,
  selected-text, right-panel, and compact Chat tests after adding confirmation. Passed affected type
  checks, targeted lint and formatting, and `git diff --check`. Picker parity additionally passed 115
  focused composer, inline-token, path, skill, and thread-reference tests plus the web type check and
  targeted lint. In an isolated web environment, confirmed blank creation through the Chat card,
  Chat availability in the `+` menu, a selected-text side chat with the source reference and Markdown
  quote prefilled but unsent, replacement Cancel and Confirm behavior, and same-target reopening
  without a dialog. Browser verification was not rerun for picker parity because it was not requested.
  The shortcut-toggle follow-up passed 8 focused tests, the web type check, targeted lint and
  formatting, and a full close-open-close cycle in the isolated dev app.

## 2026-08-13 — Adopt upstream Copy Thread ID

- Upstream baseline: `9e201941a`
- Change: Removed the fork-specific **Copy Thread ID** variant and adopted upstream's shared thread
  action for the sidebar and chat header.
- Reason: Upstream now provides the same behavior, so keeping a second fork implementation would
  create needless drift.
- Scope: Web and desktop thread action menus and fork maintenance history. Thread forking remains a
  separate fork feature.
- Verification: Passed 160 merge-focused tests, 118 focused web tests, and the contracts, web,
  mobile, and server type checks. Formatted the resolved files and checked the final diff.

## 2026-08-14 — Restore thread reading positions

- Upstream baseline: `9e201941a`
- Change: Web and desktop remember a stable timeline row and its intra-row offset when the user
  switches away from a thread, then restore that position when the user returns during the same app
  session. Reaching the live edge or sending clears the bookmark.
- Reason: Thread navigation previously reopened every conversation at the live edge and lost the
  user's reading position.
- Scope: A fork-owned in-memory bookmark module, narrow LegendList and chat lifecycle seams, focused
  tests, and user documentation. Mobile, server contracts, providers, and database persistence are
  unchanged.
- Verification: Passed 21 focused bookmark and timeline tests, the web type check, targeted lint
  and formatting, and `git diff --check`. In an isolated web environment, switched away after
  positioning a message row at `-52.42px`, then returned to the same row at exactly `-52.42px`.

## 2026-08-15 — Adopt upstream desktop asset staging

- Upstream baseline: `a5e29edee`
- Change: Fork desktop releases now use upstream's generated macOS icon and DMG background staging.
  Removed the obsolete runbook fallback that copied the deleted
  `apps/desktop/resources/icon.icns`. Fork product naming, bundle identity, exact-version checks,
  and omission of the upstream update feed remain unchanged.
- Reason: Upstream removed the checked-in desktop icon outputs in favor of generating them from the
  current brand sources. Keeping the old shim would let a release silently package a stale icon.
- Scope: Desktop packaging integration and the manual fork release runbook. Runtime behavior and
  application data remain unchanged.
- Verification: Passed all 53 focused desktop packaging and fork identity tests, the scripts,
  shared, and desktop type checks, targeted lint and formatting, and `git diff --check`.

## 2026-08-15 — Match the side chat to the main chat

- Upstream baseline: `a5e29edee`
- Change: Replaced the side chat's hand-built transcript and composer with the same
  `MessagesTimeline` and `ChatComposer` used by the main chat. The side adapter now supports shared
  message, activity, image, picker, model, mode, approval, and user-input presentation while every
  command remains bound to the side thread.
- Reason: The copied compact UI had already drifted from the main chat in typography, spacing,
  message rendering, composer styling, and controls.
- Scope: Fork-owned compact Chat adapter and command builders, focused parity tests, side-chat user
  guidance, and the superseded compact-surface specification. `ChatView`, server orchestration,
  contracts, providers, mobile, and other right-panel surfaces are unchanged.
- Verification: Passed 153 focused side-chat, timeline, composer, mention, footer, right-panel, and
  replacement tests; the web type check; targeted lint and formatting; and `git diff --check`. In
  an isolated dev stack, real `package.json` mentions sent successfully from both the main and side
  composers without unloading the page. Their composer forms also measured at identical vertical
  bounds after reserving the main chat's context-strip footprint below the side composer.
- Upstream conflict map: `CompactChatSurface.tsx` remains the target-scoped adapter and imports the
  two upstream chat components directly. Repair this adapter when their props change. Do not copy
  their JSX or refactor `ChatView` into a shared controller. If upstream adds a target-aware side
  chat, remove the fork adapter after verifying owner and target isolation.

## 2026-08-15 — Give side chats their main-thread context

- Upstream baseline: `a5e29edeec`
- Change: Every web or desktop turn sent from a side surface carries typed, provider-only context
  naming the owning main thread. The provider can use the existing `thread_read` MCP tool when the
  user's request depends on that conversation, while the persisted user message remains unchanged.
  Cross-environment side surfaces omit the context.
- Reason: A side chat previously knew its target but the agent had no reliable way to discover the
  main conversation it was opened beside.
- Scope: One optional turn and provider-send field in shared contracts; narrow web side-adapter,
  orchestration event, reactor, and provider-service seams; focused tests and user documentation.
  Thread persistence, projections, right-panel state, provider adapters, native mobile, and database
  migrations are unchanged.
- Verification: Passed 151 focused contract, provider-service, reactor, and web side-chat tests;
  contracts, server, and web type checks; targeted lint and formatting; and `git diff --check`. In
  an isolated dev environment, seeded a unique fact in a main GPT-5.6-Terra thread, opened a blank
  side chat with Cmd+T, and asked for the fact without supplying the main thread ID. The provider
  called `thread_read` with the owning thread ID and returned the correct answer. The browser and
  SQLite projection both confirmed that the visible and persisted side-chat message omitted the
  provider-only context.
- Upstream conflict map: `CompactChatSurface.logic.ts` owns the send metadata. In `ChatView.tsx`,
  preserve only the owner prop passed to the side adapter. In orchestration contracts and the
  decider, preserve the optional `sideChatContext` propagation without adding it to
  `thread.message-sent`. In `ProviderCommandReactor.ts`, forward that metadata; in
  `ProviderService.ts`, prepend the fixed context after validating the user's prompt length and
  remove the metadata before calling adapters. If upstream ships native side-chat context, remove
  these seams instead of retaining two mechanisms.

## 2026-08-15 — Make newly created side chats transient

- Upstream baseline: `6a2e4a683`
- Change: Side chats created through `chat.newSide` or **Ask in side chat** now stay out of the
  creating client's thread collections and search results. Closing or replacing their side surface
  deletes the T3 thread. A LocalStorage cleanup queue deletes threads left behind by app quit or a
  crash after their environment reconnects. Threads opened through **Open in side surface** remain
  persistent.
- Reason: Short-lived follow-up chats should not accumulate in T3's thread history, but adding a
  server visibility field or provider-specific transient sessions would create broad upstream
  conflicts and inconsistent provider behavior.
- Scope: Fork-owned transient registry and launch cleanup; narrow right-panel descriptor,
  creation, replacement, close, thread-collection, and search seams; focused tests and web user
  documentation. Server contracts, database projections, provider adapters, desktop IPC, and
  native mobile are unchanged.
- Verification: Passed 80 focused transient-registry, right-panel, replacement, compact Chat, and
  command-palette tests; the web type check; targeted lint and formatting; and `git diff --check`.
- Upstream conflict map: `transientSideChatStore.ts` and `TransientSideChatCleanup.tsx` own the
  LocalStorage queue and deletion retry. In `rightPanelStore.ts`, preserve only the optional
  transient Chat marker and persistence filter. In `ChatView.tsx` and both sidebars, preserve the
  open, replacement, and close cleanup calls. In `state/entities.ts` and `state/queries.ts`, keep the
  local collection and content-search filters. If upstream adds a server-owned unlisted or
  transient thread model, prefer it and remove this client registry instead of maintaining both.

## 2026-08-15 — Remove redundant source text from selected side chats

- Upstream baseline: `6a2e4a683`
- Change: **Ask in side chat** now prefills only the selected Markdown quote. **Ask in new thread**
  keeps its source-thread reference.
- Reason: Side-chat turns already carry the owning main thread as provider-only context, so naming
  the source again in the visible draft duplicated information.
- Scope: Web and desktop selected-text prompt building, focused tests, and user guidance. Mobile,
  contracts, server orchestration, providers, and persistence are unchanged.
- Verification: Passed the focused selected-text tests, web type check, targeted lint and
  formatting, and `git diff --check`. In the isolated dev app, selected an assistant response and
  confirmed **Ask in side chat** opened an unsent draft containing only its Markdown quote.

## 2026-08-17 — Render Mermaid diagrams in web Markdown

- Upstream baseline: `a5e29edeec`
- Change: Completed `mermaid` fences render as themed diagrams in web and desktop Markdown views.
  Streaming and invalid diagrams remain source blocks. Rendered diagrams retain their fenced source
  for selection and copying and provide zoom, fit, copy, and expanded-view actions.
- Reason: Agents often explain control flow and architecture with Mermaid. Rendering the existing
  Markdown makes those answers readable without sending diagram data through new contracts or
  external services.
- Scope: A fork-owned Mermaid component and lazy renderer; one fenced-code branch in the shared web
  Markdown renderer; focused tests and user documentation. Desktop inherits the web behavior.
  Native mobile, server contracts, persistence, and providers are unchanged.
- Verification: Passed 27 focused Mermaid and Markdown tests, the web type check, targeted lint and
  formatting, the production web build, and `git diff --check`. In the isolated dev app, mounted
  the production Mermaid component and confirmed the supplied flowchart, fitted rendering, zoom
  controls, source copy, expanded view, light and dark themes, and invalid-source fallback. The
  authenticated chat route was not used because the collaborative browser rejected its one-time
  local pairing credential.
- Upstream conflict map: `components/chat/MermaidDiagram.tsx` and `mermaidRendering.ts` own the
  feature. In `ChatMarkdown.tsx`, preserve only the import and the early `language === "mermaid"`
  branch immediately before the existing code-block return. If upstream adds Mermaid rendering,
  prefer it and remove the fork-owned component instead of keeping both implementations.

## 2026-08-17 — Pan Mermaid diagrams with the mouse

- Upstream baseline: `a5e29edeec`
- Change: Web and desktop users can drag diagram shapes or empty space to pan inline and expanded
  Mermaid diagrams. Label text remains selectable, and the existing scrollbars remain available.
- Reason: Zoomed diagrams previously required direct scrollbar use to move around the canvas.
- Scope: The fork-owned Mermaid component, focused tests, and user documentation. Native mobile,
  server contracts, persistence, and providers are unchanged.
- Verification: Focused Mermaid tests, the web type check, targeted lint and formatting, and
  `git diff --check`. In an isolated dev app, a wide diagram panned horizontally in both inline and
  expanded views, a tall diagram panned vertically, label text remained selectable, and scrollbar
  presses were not intercepted.
