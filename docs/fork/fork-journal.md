# Fork journal

This journal explains the fork differences that we still maintain. Features replaced by upstream
keep only a short adoption note. Git preserves their removed implementation details and verification
history. Dated merge checks describe what was tested at that time, not additional features to restore.

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

## 2026-10-07 - Stop background commands outside recent history

- Upstream baseline: `efecd3cf8b`.
- Stop resolves its target in the orchestrator from current runs and pending background work.
  The shared web, desktop, and mobile command path skips the paginated projection lookup when
  the server advertises support. Older servers retain the existing client lookup.
- Codex records terminal handles from terminal-interaction notifications, including after a
  turn settles. Later command updates retain known handles; notifications cannot revive commands
  that have already ended.
- Reason: A visible running-command banner could outlive the latest 77 history rows, causing Stop
  to return without sending an interrupt. Commands started without a handle could also be marked
  stopped without receiving a native termination request.
- Scope: Optional interrupt target and capability contracts, shared client command dispatch,
  orchestrator target resolution, and the Codex adapter. No database migration or UI changes.
- Verification: Focused client, Codex replay, background-work integration, queue, capability, and
  desktop packaging tests passed. Scoped server, contracts, client-runtime, web, and mobile
  typechecks and targeted lint passed. The late-handle regressions fail without the adapter fix.
  Live user data and the installed desktop app were unchanged.

## 2026-10-06 - Inherit caller permissions when launching threads

- Upstream baseline: `efecd3cf8b`.
- MCP `t3_thread_launch` uses the same runtime and interaction mode checks as `create_threads`.
  Active callers can launch with inherited or narrower permissions. Permission escalation fails
  before scratch-folder creation or workspace preparation.
- The fork removes upstream's blanket full-access/default requirement. Tool descriptions and
  provider instructions describe the inherited permissions. Other project mutations keep their
  existing restrictions. No client, provider adapter, or wire contract changes are needed.
- Verification: 24 focused handler and provider-instruction tests, server typecheck, targeted lint,
  and formatting passed. The original handler fails 15 of the updated handler tests.
  In the isolated dev client, Codex Terra low launched scratch and existing-checkout threads with
  inherited auto/default modes and completed their turns. A narrower approval-required/plan launch
  persisted those modes; a full-access override returned runtime_mode_escalation_denied without
  creating a thread. Persisted state and client screenshots confirmed the results.

## 2026-10-06 - Postpone threads without a timer

- Upstream baseline: `efecd3cf8b`.
- The current web and desktop sidebar has a Postponed section with normal thread cards,
  single and bulk Postpone and Move to active actions, and a remembered collapse state.
  Opening a thread shows a composer notice. A new user message restores it automatically,
  including sends from side chats. Completion, failure, and attention requests leave it postponed.
- A separate client preference stores environment-scoped thread keys and the last user-message
  timestamp. It persists across restarts in that browser or desktop profile, without syncing to
  other devices. No database migration, wire contract, provider adapter, or server changes.
  The legacy sidebar and native mobile have no new section.
- Merge-sensitive changes are limited to the sidebar's classification, menus, card rendering,
  navigation and drag boundaries; the shared header menu; and narrow composer and layout hooks.
  The web context-menu fallback includes pause and play icons for the parking actions.
  Storage, restoration, menu additions, and the composer notice live in separate fork modules.
- Verification: 239 focused storage, restoration, menu, snooze, sidebar and drag tests passed.
  Web typecheck passed. Targeted lint has no errors; existing large UI files report warnings.
  Dev state uses a pruned read-only snapshot of stopped threads in a temporary home.
  Browser and native-client verification were not performed.

## 2026-10-05 - Exclude individual Claude and Codex accounts from usage

- Upstream baseline: `efecd3cf8b`.
- Web and desktop provider settings can exclude a Claude or Codex account's history from Cost
  and Tokens. Limits and provider availability are unchanged. Re-enabling inclusion restores
  retained usage. An included account still contributes a directory shared with an excluded account.
- The preference is `forkUsageDashboardIncluded: false` inside the existing provider instance
  config in `settings.json`. Inclusion is the default and removes the key. No settings schema,
  wire contract, or database migration changes are needed. Upstream builds preserve the config
  field but ignore its behavior.
- Merge-sensitive changes are limited to the provider settings component, usage source selection
  and scan key, the shared client usage refresh dependency, and one shared package export. The
  preference helpers and UI control live in separate fork files. Native mobile has no new control;
  server filtering applies to every client and connection mode.
- Verification: 44 focused service, JSON round-trip, client refresh, and provider form tests passed.
  Server, web, shared, and client-runtime typechecks passed. Targeted lint had no errors and one
  existing unused-variable warning. An isolated browser pass with copied usage data verified
  Claude and Codex exclusion, re-enabling, JSON persistence after reload, and Cost and Tokens
  totals. Native-client verification was not performed. Live settings and provider history
  were unchanged.

## 2026-10-04 - Integrate the latest upstream batch

- Upstream baseline: `efecd3cf8b`, following `8ed276c246`. Integrates 127 upstream commits
  on `integration/upstream-2026-10-04`. The separate desktop-profile import branch is excluded
  because the profile recovery is already complete.
- Mermaid rendering now uses upstream's implementation in full. Its renderer, Markdown integration,
  dependencies, lockfile, and license configuration match upstream exactly.
- Retained fork behavior includes `%` and `%%` references, side chats, transient cleanup,
  selected-text actions, workspace management, project switching, custom shortcuts, visualization
  links, and Fork packaging. Conflict resolutions retain both upstream and fork shortcut tests,
  upstream host selection, and transient-thread filtering in search. The retired branch selector
  remains replaced by the fork workspace menu.
- Verification: 691 focused web, server, contracts, workspace, and background-stop tests passed.
  Web, server, and desktop typechecks and the web production build passed. Targeted lint had
  no errors; warnings remain. Diff checks passed outside unchanged upstream patch files,
  whose blank context lines contain spaces. An isolated browser verified Mermaid in main and side
  chats, light and dark themes, source switching and copying, expanded SVG loading and dismissal,
  invalid-source fallback, multiple diagrams, and reload. Native-client verification was not performed.
  The `fork` branch, live profile, and remote branches were not changed.

## 2026-10-04 - Adopt upstream Mermaid rendering

Upstream `5e35272fda`, integrated through `efecd3cf8b`, replaces the fork Mermaid renderer
completely. The fork component, helper, zoom and pan controls, dependencies, license overrides,
and guide were removed. Mermaid is no longer downstream drift.

## 2026-10-04 - Restore scoped thread-reference shortcuts on V2

- Upstream baseline: `8ed276c246`.
- Restored `%` for the composing project's threads and `%%` for all projects in the current
  environment. Bare triggers browse recent user activity. Queries accept spaces and search titles,
  project names, branches, and thread IDs. Escape preserves the text; Enter with no results keeps
  the picker open. Embedded percentages such as `100%` do not open it.
- Selection uses upstream's context chips, draft records, and provider projection through
  `t3_thread_read`. The retired fork URI format and MCP implementation remain removed.
- Scope: web and desktop main, draft, and side-chat composers. Existing `@` references remain
  available. Native mobile, provider adapters, contracts, persistence, and server behavior are unchanged.
- Verification: 291 focused picker, trigger, dismissal, context projection, rich-text, and draft
  persistence tests passed. Web typecheck and targeted lint passed, with existing lint warnings.
  The broader draft-store suite has one stale Auto-default assertion that also fails on the
  untouched integration commit. An isolated browser pass verified bare and multiword queries,
  project switching, environment scope, current-thread exclusion, Enter and Tab selection,
  Escape and continued typing, empty-search handling, chip persistence after reload, independent
  side-panel drafts, literal percentages, and existing `@` results. Native-client checks were not performed.

## 2026-10-04 - Keep both side-chat roles visible in the sidebar

- Upstream baseline: `8ed276c246`, with parent navigation added against `efecd3cf8b` on 2026-10-07.
- Both web and desktop sidebar layouts mark threads that host a side chat and threads used as
  side chats. The host uses the outline split-panel icon; the side-chat thread uses a filled right
  pane. Indicators follow saved chat tabs across navigation, hidden panels, and tab switches.
- Removing or replacing a chat tab updates the roles. Threads can have both roles, and a shared
  target stays marked until its last owner removes it. State remains local to the client.
- Clicking the filled indicator opens its parent thread and reveals the saved side chat, even
  when the panel was hidden or another tab was selected. Keyboard activation does the same.
  A target shared by several parents opens its first saved parent. Existing tabs and transient
  chat metadata stay intact. Both sidebar layouts share this behavior; native mobile has no indicator.
- Verification: All 96 focused panel-state and indicator interaction tests passed, along with the
  web typecheck and targeted lint. Existing sidebar lint warnings remain. An isolated Browser panel
  pass verified the current sidebar's row navigation, parent navigation from a hidden panel,
  keyboard activation, and the "In a side chat" label. Native mobile and the legacy sidebar
  were not tested in a running client.

## 2026-10-04 - Integrate upstream Orchestration V2

- Upstream baseline: `8ed276c246`, following `de251fc297`. Integrates the reviewed 102 commits
  on `integration/upstream-2026-10-04`, starting from fork commit `3d23e894299a`.
- Upstream now owns thread control, native forks, reference picking, and runtime defaults. The
  fork implementations were removed first, including their partially replaced behavior.
- Retained side chats, selected-text actions and quotes, transient hiding and provider-history
  cleanup, Codex visualization links, workspace management, sidebar hover reveal,
  project filtering and switching, custom shortcuts, Fork branding, and T3 Connect defaults.
- Adaptations: side chats use V2 projections, requests, runs, and provider sessions. New-thread
  selection prompts attach upstream context records. Side-chat owner context names upstream's
  `t3_thread_read` tool. Cleanup captures native IDs and provider configuration fingerprints,
  blocks late admission through persisted markers, and awaits native unload before deletion.
  Shared provider runtimes remain available to their other threads.
- Verification: focused retained-feature and V2 launch/fork/delete tests passed. Scoped web,
  server, desktop, contracts, and client-runtime typechecks passed. Targeted lint had no errors;
  existing warnings remain. Web and server bundles passed, including a bundled transient-deletion
  command smoke test that rejected an invalid native ID before provider access. Browser and
  native-client verification were not performed. The live install and original fork checkout
  were not changed.

## 2026-10-04 - Repair regressions found in live V2 verification

- Upstream baseline: `8ed276c246`.
- Codex transient cleanup deletes through the runtime that owns the native writer. A second
  app-server could not delete an active writer after unsubscribe. Cleanup now stops native work
  before V2 deletion schedules detach, preserves shared runtimes, and retains failed jobs for retry.
- Selected-text new-thread actions prefill the exact draft returned by upstream navigation.
  Looking up the project again could select an older draft with a different logical project key.
- Side-chat focus no longer counts as browser-preview focus inside the shared right-panel wrapper.
  Guarded prompt-navigation shortcuts now reach the side timeline without moving the main timeline.
- Verification: 1,049 focused tests and five installed-provider deletion safety tests passed.
  Live Codex Terra and Claude Sonnet checks verified owner context through upstream `t3_thread_read`,
  native history removal, preservation of the owner, and upstream native fork history. Browser
  checks covered selection drafts and reuse, regular side chats and both sidebar indicators,
  hover reveal in both layouts, workspace rename and removal, project filtering and switching,
  F2, Cmd+W, prompt navigation, Mermaid rendering and fallback, and visualization-file preview.
  Web and server typechecks and bundles passed. Targeted lint had no errors. Screenshot and resize
  tools failed, and later browser interactions timed out. Native desktop and mobile UI checks
  were not performed. All provider homes and server state were disposable; live data was untouched.

## 2026-10-04 - Adopt upstream thread control, forking, and defaults

Upstream `8ed276c246` replaces the fork MCP thread-control toolkit, native thread-forking
implementation, and hardcoded Auto defaults. The fork implementations were removed completely,
including advanced controls and their client actions. Maintain upstream's behavior for these features.

The old conversation-reference URI and composer nodes were also removed. `%` and `%%` were later
restored against upstream's context records, as documented above.

## 2026-09-27 - Repair regressions found in live fork verification

- Upstream baseline: `de251fc297`.
- Worktree removal now refreshes the target's Git status after non-force removal fails. The force
  confirmation previously used the closed menu's stale snapshot and could report zero dirty files.
- Shift+Escape ignores closed popups retained in the DOM. Upstream's mounted header menu otherwise
  blocked clearing the project filter even when no menu was open. Open popups still consume Escape.
- Verification: reproduced both failures and verified their fixes in an isolated dev client.
  The historical 335-test subset, web typecheck, and targeted lint passed. Live Codex Terra,
  Claude Sonnet, and OpenCode Terra checks covered transient provider-history deletion.
  Browser checks covered selected-text actions, side-chat reuse and focus, both sidebar layouts,
  project filtering, workspace safeguards, and HTML links. Native device access was disabled
  and browser resizing timed out. Native shells and remote/tunnel connections were not exercised.
  The installed app and live database were not changed.

## 2026-09-27 - Integrate upstream through de251fc297

- Upstream baseline: `de251fc297`, following `7445aa733ada`. Integrates 279 upstream commits
  on `integration/upstream-2026-09-27`, starting from fork commit `e79f64f52a`.
- Preserved side chats, transient provider-history cleanup, selected-text actions, workspace
  management, visualization links, sidebar hover reveal, custom shortcuts, and Fork packaging.
  Workspace names remain visible, creating worktrees show upstream's setup label, and composer
  suggestions retain global Escape handling.
- Verification: 3,196 focused tests passed across 109 files, followed by 86 compaction and
  provider/projector tests. Scoped web, server, desktop, mobile, contracts, shared, and
  client-runtime typechecks, targeted lint, and web/server builds passed. Bundled Claude history
  and transient-deletion smoke checks used a disposable provider home. Browser checks, live
  turns, native builds, installers, publication, and live-data changes were not performed.

## 2026-09-26 - Reveal the hidden sidebar on hover

- Upstream baseline: `7445aa733ada`.
- Change: Holding the mouse at the left edge reveals the collapsed sidebar as a temporary
  overlay. Leaving closes it after a short grace period; Escape dismisses it. The sidebar toggle
  still pins it open, and hover does not change the main view's width or the saved pinned state.
- Reason: Access thread navigation without giving up horizontal space in the main view.
- Scope: Web and desktop, both sidebar layouts and Settings. Touch drawers, native mobile,
  provider adapters, contracts, and connection handling are unchanged.
- Verification: Passed 17 focused tests, web typecheck, targeted lint with an existing warning,
  formatting, and whitespace checks. An isolated browser verified hover intent, leave delay,
  Escape dismissal, pinning, Settings, both sidebar layouts, and menus extending beyond the panel.
  The main view remained 1,536 pixels wide while the preview opened. Browser resizing timed out,
  so narrow-screen behavior and the native desktop shell were not visually verified.

## 2026-09-21 - Focus side-chat drafts after selected-text actions

- Upstream baseline: `7445aa733ada`.
- Change: Each **Ask in side chat** action requests focus for its target composer after the
  citation reaches the editor, with the caret after its trailing space. Existing drafts remain intact.
- Reason: Reusing an open side chat appended the citation without rerunning its initial focus effect.
- Scope: Web and desktop selection actions and the compact chat composer. Focus requests identify
  the target environment and thread; provider adapters and native mobile are unchanged.
- Verification: Reproduced focus remaining on the page body before the fix. An isolated browser
  verified new, visible, and hidden side chats, repeated selections, preservation of existing drafts,
  a single space after the citation, and typing into the side composer without clicking it.
  Passed 29 focused tests and the web typecheck. Targeted lint retained only existing warnings.

## 2026-09-13 — Reuse transient side chats for selected text

- Upstream baseline: `b1e223e2b0`
- Change: **Ask in side chat** appends the selected-text citation to an existing transient
  side-chat draft and reveals that chat without replacement confirmation. Existing draft text
  is preserved, and nothing is sent automatically.
- Reason: Follow-up selections belong in the temporary conversation already open beside the thread.
- Scope: Web and desktop selection actions, scoped by owning thread and environment. Regular side
  chats and explicit new-side-chat actions retain their replacement behavior. Mobile has no matching
  selection action; provider adapters, contracts, and connection handling are unchanged.
- Verification: Focused selection and replacement tests, web typecheck, targeted lint and formatting,
  and `git diff --check`. An isolated browser with a snapshot of real conversations verified initial
  creation, repeated selections in the same unsent draft, preservation of typed text, reopening a
  hidden chat, returning from Files, and cancellation of explicit new-chat replacement. SQLite
  confirmed no extra threads or sent messages after reuse.

## 2026-09-12 - Consolidate selected-text actions in the citation toolbar

- Upstream baseline: `163d86a78`
- Change: **Ask in new thread** and **Ask in side chat** now appear beside **Cite** in the floating
  selection toolbar. All three use Cite's single-assistant-message selection rules and 8,000-character
  limit. Removed the selected-text right-click wrapper, menu helpers, separate selection reader,
  and side-chat blockquote fallback. New-thread drafts retain their Markdown quote and source-thread
  reference; side-chat drafts retain their assistant citation. Neither action sends automatically.
- Reason: Offer one discoverable selection menu and reuse upstream's selection lifecycle.
- Scope: Web and desktop main timelines, selected-text prompt tests, and user guidance. Compact
  side-chat timelines, native mobile, provider adapters, wire contracts, and server behavior are unchanged.
- Verification: Passed 128 focused selection, prompt, and timeline tests, the web typecheck, targeted
  lint (existing warnings in ChatView and MessagesTimeline), formatting, and whitespace checks.
  In an isolated browser using a SQLite snapshot of real threads, verified all three actions,
  Markdown and source references in the new main draft, a citation in an unsent side chat, side-chat
  closing, Tab navigation, Escape and scroll dismissal, unhandled right-click, and rejection of
  user-message and cross-message selections. Synthetic 8,000/8,001-character selections verified
  the length boundary. Desktop viewport-edge placement passed; the browser resize tool timed out
  before narrow-viewport verification.

## 2026-09-13 — Render Codex visualization references as file links

- Upstream baseline: `b1e223e2b0d87124883b1410ab52dd6a1338e40d`
- Change: Codex's private-use `visualize` markers now resolve their JSON `path` through the existing
  file-link renderer. Completed markers show the filename and copy as ordinary Markdown links;
  malformed markers and examples in code or existing links remain literal.
  Source-view dismissal waits until the editor is initialized.
- Reason: Visualization responses previously exposed raw markers and JSON instead of an accessible
  link to the generated HTML file.
- Scope: Shared Markdown parsing and copy/native adapters, covering web and desktop main/side chats
  and mobile. Existing environment-scoped file opening, preview, and close behavior applies.
  Server asset responses cover local and remote clients. Provider adapters, wire contracts,
  Settings, and shortcuts are unchanged.
- Verification: Passed focused parser, streaming/click, copy, native Markdown, file-preview, and HTTP tests;
  web, mobile, server, and changed-parser typechecks; targeted lint, formatting, and diff checks.
  The full client-runtime package typecheck reports two existing `ClientOrchestrationCommand`
  references in `operations/commands.test.ts`, also present at the fork baseline.
  An isolated dev server with a snapshot of real threads verified the original response in main
  and side chats, copying as a Markdown link, opening HTML inside and outside the workspace,
  source/rendered preview switching (including during initial loading), and closing/reopening the
  file. Native simulators were not run.

## 2026-09-12 — Use inexpensive models for provider tests

- Upstream baseline: `b1e223e2b0d87124883b1410ab52dd6a1338e40d`
- Change: Fork verification instructions prohibit expensive test models and call for models such
  as Claude Sonnet and Codex Terra, using low effort and short prompts and responses.
- Reason: Integration tests should verify behavior without unnecessary provider costs.
- Scope: Live provider testing across all clients, including main threads, side chats, native forks,
  and MCP children. Test models must be selected explicitly instead of inherited from defaults.
- Verification: Documentation review, targeted formatting, and `git diff --check`.

## 2026-09-12 - Adopt upstream ordering and context

- Upstream baseline: `b1e223e2b0d87124883b1410ab52dd6a1338e40d`.
- Upstream now owns active-thread ordering and settled timestamps. Removed the fork sorting
  implementation. Side chats adopted upstream's context, question attachment, dismissal,
  project-default, and stop-shortcut behavior.
- Verification: focused contract, provider, settings, web, mobile, desktop, and packaging tests,
  scoped typechecks, targeted lint, frozen installation, and web/server builds passed. Isolated
  web and Electron checks covered side-chat questions with images, cancellation, ordering,
  settle/reopen, project filtering, settings, and phone/tablet layouts. Native mobile execution
  was unavailable on this host.

## 2026-09-11 — Clear the project filter from the keyboard

- Upstream baseline: `223ff4490f76`
- Change: Added **Project: Show All Projects**, defaulting to Shift+Esc outside terminal and preview
  focus, and a separated **All Projects** action after the Project Switch choices. Both clear only
  the sidebar project filter and retain the current chat or draft. Shortcut recording now accepts
  modified Escape while plain Escape cancels recording.
- Reason: Project Switch provides a quick way to focus on a project; users need an equally direct
  way to return to all projects.
- Scope: Shared keybinding catalog/defaults, web and desktop shortcut handling, command palette,
  Settings, and user guidance. Existing menus and dialogs retain dismissal priority. Mobile,
  providers, and server orchestration are unchanged.
- Verification: Passed 134 focused tests, web/contracts/shared type checks, targeted formatting,
  lint, and diff checks. In an isolated web environment copied from real data, verified configured
  Project Switch navigation, the All Projects picker and command-palette actions, Shift+Esc with
  drafts and existing chats, draft-text preservation, repeated clearing, overlay dismissal priority,
  and modified-Escape shortcut recording with plain-Escape cancellation.

## 2026-09-06 - Integrate upstream shared project defaults

- Upstream baseline: `223ff4490`
- Change: Merged 293 upstream commits. Replaced the Fork new-chat provider, model, and effort
  controls with upstream's shared project defaults and scoped overrides. Saved provider, model,
  and effort defaults migrate when settings load; explicit values and resets in the new field win.
  Removed the permission-default extension and discarded its saved value, using upstream's
  inherited-permission behavior.
  Saving removes the retired field. New side chats use project model overrides before shared
  defaults.
- Reason: Adopt upstream's defaults behavior while preserving saved model preferences. Project
  overrides now take precedence over shared model defaults.
- Scope: Settings contracts and persistence, web and desktop settings, main and side-chat creation,
  and mobile drafts. Integrated upstream compaction declarations, project browser access,
  environment balancing, pending request handling, composer APIs, and sidebar filter persistence
  while preserving side chats, workspace management, and custom navigation.
- Verification: Focused provider, orchestration, HTTP/WebSocket, settings migration, contracts,
  client-runtime, web, desktop, mobile, and packaging tests passed. Type checks passed for server,
  web, desktop, mobile, contracts, shared, and client-runtime. Web and server bundles built.
  Frozen dependency installation passed supply-chain checks. Targeted lint reported no errors;
  formatting and resolution whitespace checks passed. The unchanged upstream Pierre patch has
  space-before-tab payload lines. After removing the permission extension, 160 focused tests and
  server, web, and mobile type checks passed. In an isolated browser with copied thread data and
  a temporary Git project, verified migration, effort changes, inherited permissions, preserved
  unsent drafts, worktree selection, side-chat creation, project model overrides, and reset to
  shared defaults. Preview screenshot capture failed; browser verification used DOM inspection
  and interactions, with saved settings and thread records checked separately.

## 2026-09-05 - Manage worktrees from the workspace picker

- Upstream baseline: `163d86a78`
- Change: Web and desktop share a workspace menu listing local worktrees with busy or dirty status.
  Row menus support inline directory rename, path copy, desktop reveal, and confirmed removal.
  The menu fetches checked-out local refs and detached worktrees, retains selection indicators, and
  stays open after rename. Detached worktrees show `(detached)` and remain detached when selected or
  renamed. Removal warnings report no upstream instead of treating default-branch distance as unpushed commits.
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
  selection, and rename leaving the menu open. Detached-worktree coverage passed with 152 focused
  Git driver, toolbar, and contract tests, server/web/contracts type checks, and targeted lint and
  formatting. It covers multiple detached checkouts at one commit, stale paths, current-worktree
  detection, branch-list isolation, and rename/removal cache refresh without attaching a branch.
  An isolated dev browser with copied production data verified both `shiphero-api` worktrees,
  the `(detached)` label, selecting alpha as the current workspace, and returning to the local
  checkout. Read-only Git checks confirmed alpha stayed detached at its original commit.

## 2026-09-04 - Merge upstream browser, usage, terminal, and provider changes

- Upstream baseline: `163d86a78`. Integrated 174 upstream commits.
- Preserved side chats, transient context, prompt navigation, project filtering, and Fork desktop
  identity and update rules. Adopted upstream orchestration replay, runtime-context queries,
  compaction, analytics, Markdown, browser import, usage reporting, and terminal changes.
- Verification: 790 focused tests, scoped server, web, mobile, contracts, and shared typechecks,
  frozen installation, targeted lint and formatting, and conflict-marker checks passed.
  Whitespace findings were limited to three payload lines in upstream's React Native patch.

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

## 2026-09-03 - Merge upstream assistant citations, attachments, and desktop changes

- Upstream baseline: `fff33f9e8`. Integrated 276 upstream commits.
- Preserved side chats, transient context, prompt navigation, project filtering, and Fork desktop
  identity and update rules. Selected-text side chats use upstream assistant citations.
  Cmd/Ctrl+W follows terminal and right-panel close behavior before settling the current thread.
- Verification: 699 focused tests and a final 400-test subset passed, along with scoped
  typechecks, targeted lint and formatting, frozen installation, and conflict-marker checks.
  The isolated web/server stack responded successfully before its captured process was stopped.

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

- Upstream baseline: `acb599d2dc5b`. Integrated 112 upstream commits.
- Side chats adopted upstream's attachment upload queue. Fork desktop builds remain excluded
  from upstream and preview update feeds. The server entrypoint canonicalizes npm and npx
  symlinks so macOS path aliases do not prevent CLI startup.
- Verification: the historical package test matrix passed 7,326 tests with 10 skipped, plus
  merge-focused desktop packaging tests. Scoped typechecks, web/server builds, frozen installation,
  targeted lint and formatting, and diff checks passed. Isolated browser checks covered main
  and side-chat attachments and side-chat composition.

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

## 2026-08-13 - Adopt upstream Copy Thread ID

Upstream `9e201941a` replaces the fork Copy Thread ID action in the sidebar and chat header.
The fork-specific implementation was removed.

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

- Upstream baseline: `a5e29edeec`, adapted to Orchestration V2 at `8ed276c246`.
- Change: Every web or desktop turn sent from a same-environment side surface carries provider-only
  context naming the owning main thread. After the V2 integration, the provider reads that thread
  through upstream's `t3_thread_read`. Persisted user messages remain unchanged.
- Reason: A side chat previously knew its target but the agent had no reliable way to discover the
  main conversation it was opened beside.
- Scope: Side-chat send metadata, the V2 run context, and provider prompt projection.
  Cross-environment side surfaces omit owner context.
- Verification: The initial 151 focused tests, scoped typechecks, and isolated owner-context check
  passed. The later V2 live checks recorded above verified owner discovery through `t3_thread_read`.

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

## 2026-09-12 — Provider history deletion for transient side chats

- Upstream baseline: `b1e223e2b0`
- Change: Transient side-chat closure, replacement, and startup cleanup now call a dedicated
  server RPC that resolves the native session from the existing provider binding, stops it, and
  deletes its Codex, Claude, or OpenCode history. Failed cleanup stays in the existing browser
  registry. Other providers retain T3-only cleanup.
- Reason: Temporary conversations should not accumulate provider history. Native lineage and
  unreadable-history checks fail explicitly; there is no cascading or guessed-file deletion.
- Scope: Isolated provider deletion modules and Claude SDK worker, one RPC contract/handler,
  the existing transient web/desktop hook, and a small provider admission guard. Pending/completed
  markers use the existing runtime payload to prevent later resume and support retries, without
  a database migration. Ordinary thread deletion is unchanged. Native mobile has no transient
  side-chat hook to change.
- Verification: Focused provider, lifecycle, provider-service, registry, authorization, and WebSocket
  tests; scoped server/web/contracts type checks; targeted lint/formatting; server bundle and
  bundled Claude worker smoke test. Browser E2E used an isolated dev server and provider homes
  with real Codex Terra, Claude Sonnet, and OpenCode Terra turns. Verified native history removal on close/replacement, blank-chat cleanup, and preservation
  of the main thread. A Claude child-transcript fixture caused refusal and remained queued; after
  removing it, page-startup retry deleted the provider history.
- Provider constraint: Closing Codex during first-session startup can leave an empty rollout.
  Codex 0.154.0 refuses both reading and deleting that file through its API. Cleanup returns an
  error and retains the job; retries require the provider history to become readable or be repaired.
  The native regression test prevents mistaking this state for an absent session.
- Upstream conflict map: Most behavior lives in new modules. Integration seams are the provider
  service admission wrappers, WebSocket registration/authorization, shared RPC schema, transient
  cleanup hook, and Claude worker bundle entry. Revisit the narrow raw Codex descendant query when
  its generated client exposes that experimental filter.

## 2026-09-20 - Integrate upstream 0.0.42

- Upstream baseline: `7445aa733ada`, following `b1e223e2b0`. Integrates 336 upstream commits
  on `integration/upstream-2026-09-20`, starting from fork commit `d204ea91f238`.
- Upstream now owns reading-position restoration and compressed asset content types. Removed
  the fork bookmark cache and restoration hook, retaining the mounted thread-switch regression
  against upstream's DOM-aware implementation.
- Preserved side chats, selected-text actions, transient provider-history cleanup, workspace
  management, custom shortcuts, and Fork desktop identity. Claude history and deletion workers
  support the bundled CLI. Side chats remain single-model and accept follow-ups after a turn ends.
  Workspace selection follows upstream's separate-worktree requirement for multiple models.
- Verification: more than 3,000 focused tests, scoped web, desktop, mobile, server, contracts,
  and client-runtime typechecks, targeted lint, and web/server builds passed. Bundled history
  and transient-deletion smoke checks used a disposable provider home. No live turns, browser
  checks, native builds, installers, publication, or live-data changes were performed.

## 2026-09-20: Repair regressions found in live integration testing

- Upstream baseline: `7445aa733ada`.
- Cleanup now resolves built-in provider settings through upstream's instance hydration helper.
  Looking only in explicit `providerInstances` rejected ordinary Codex and Claude side chats
  before deleting either the T3 thread or provider history. Explicit instance settings still win.
- The Tiptap composer handles Escape before ProseMirror's unconditional Escape suppression.
  Open composer suggestions dismiss first; otherwise global shortcuts, including Shift+Escape
  to clear the project filter, receive the event without losing the draft.
- Verification: the three new built-in-provider cleanup regressions failed before the fix and
  passed afterward. The focused cleanup and shortcut suites passed 294 tests. Server and web
  typechecks, targeted lint, and production bundles passed. Isolated live Codex Terra and Claude
  Sonnet checks verified side-chat cleanup, selection reuse, workspace
  management, thread references, and the affected shortcuts. Browser screenshot capture failed;
  native device access was disabled. Desktop installers and live user data were not touched.
