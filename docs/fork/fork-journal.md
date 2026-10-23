# Fork journal

## 2026-10-23 - Match HTML preview permissions to published pages

- Upstream baseline: `325a7e2ae4`.
- Change: Headless HTML preview and published HTML assets share the same document sandbox
  policy. Tool instructions explain that cookies and browser storage are unavailable and state
  the 512,000-character input limit.
- Reason: A generated walkthrough passed preview but rendered blank inside its thread because
  an unguarded `localStorage` read stopped its script. Preview now reports that same error.
  Published-page permissions remain unchanged.
- Verification: All 46 focused HTML rendering and HTTP tests passed with the real headless
  browser, including a regression test for blocked storage access. Server typecheck, targeted
  lint, formatting, and diff checks passed. An isolated copy of the thread reproduced the blank
  page; guarding preference access repaired that copy. Browser checks covered inline and full
  screen display, split diffs, theme switching, and section controls. The original HTML produced
  storage errors in the updated preview; the repaired copy produced none. Live thread data and
  attachments were not modified. Native clients and remote connection modes were not exercised.

## 2026-10-19 - Integrate the reviewed upstream batch

- Upstream baseline: `325a7e2ae4bf504cdaeb7b842e88b47f60b4bf59`, 503 upstream commits
  after the previous baseline `da7c4f234db3`. Integration uses the reviewed snapshot on
  `integration/upstream-2026-10-19`. Later upstream commits are outside this batch.
- Keep the fork workspace picker as its own UI component. It uses upstream Git commands,
  permissions, and thread metadata updates. Adopt upstream's quiet thread subscriptions and
  workspace shortcut hint. Keep named directories, colors, rename and reuse controls, and
  editing an existing thread's workspace. There is no second picker or new preference.
- Keep grouped workspace cards and Postponed. Combine their row actions with upstream's
  metadata grid, parent highlighting, shared timer subscriptions, pin placement, and drag fixes.
  Keep Continue Workspace, project switching, custom shortcuts, and percent references while
  adopting upstream's command-palette navigation and state changes.
- Keep side chats, transient cleanup, owner context, and selected-text draft actions. Integrate
  upstream's timeline structure, selection visibility fixes, panel behavior, and reduced-motion
  navigation. Preserve upstream's closed-panel dismissal metadata across reloads while excluding
  transient chats from persisted panel preferences.
- Combine upstream's conditional table expansion control with the fork's fit-width wrapped
  tables. Keep per-account Cost and Tokens exclusions alongside upstream's Limits deduplication.
  Keep server-side Stop target resolution beyond loaded history and late Codex terminal handles
  alongside upstream's running-state and delegated-follow-up fixes.
- Keep fork branding, hover sidebar, visualization-marker handling, and packaging identity.
  Apply upstream's explicit null publishing configuration as well as the fork update-feed guard.
  Upstream migrations 63 and 64 arrive unchanged. No fork migration or startup repair was added.
- Verification: Focused server, provider, persistence, web logic, contracts, packaging, and
  Chromium tests passed. Scoped server, web, desktop, mobile, contracts, and client-runtime
  typechecks, targeted lint and React Compiler checks, and web and server production builds
  passed. The isolated Browser-panel pass covered picker reuse, named worktree creation with
  color, existing-thread workspace moves, Continue Workspace with unsent drafts, grouping
  preference changes, Postponed and its reverse action, side-chat rendering and closure, and
  selected text opening an unsent new-thread draft. No provider turn was sent. The isolated
  database applied upstream migrations 63 and 64 and passed integrity and foreign-key checks.
  Native Electron and mobile clients and remote connection modes were not exercised.

## 2026-10-19 - Reserve database migrations exclusively for upstream

- Upstream baseline: `da7c4f234db3`; reviewed upstream through `325a7e2ae4`.
- Change: Remove the fork-owned `63_RemoveThreadTagEffects` migration and its registration.
  Tag-task cleanup and correction of an already recorded fork entry are separate maintenance,
  never app-startup migrations. Fork guidance prohibits downstream schema changes and migrations,
  including data-only cleanup, reserved numbers, and changes to upstream migration identities.
- Reason: Upstream assigned 63 to `DropUnusedV1Projections`. Our data-only migration claimed the
  same ID and made the migration history incompatible. Keeping upstream merges routine requires
  leaving upstream's entire migration sequence alone.
- Scope: Migration registration, obsolete migration files, and fork operating instructions.
  Existing tag sidecar files remain untouched. An older installed build must be replaced before
  its next launch or it can register the removed fork migration again.
- Verification: All eight focused migration tests, targeted lint, formatting, and diff checks
  passed. The separate repair passed on a consistent snapshot of the real database, including
  repeat execution and rejection of unexpected history, later migrations, remaining tag tasks,
  and trigger side effects. Upstream's actual migration 63 SQL then ran successfully on the
  repaired snapshot, which passed SQLite's integrity check. The authorized live repair created
  a persistent SQLite backup and removed exactly one matching history row in a transaction.
  Live history now ends at 62, with no obsolete tag tasks. No schema or application data changed;
  the running app and agents were not stopped. The installed binary was not rebuilt or replaced.

## 2026-10-17 - Continue the current workspace in a new local chat

- Upstream baseline: `da7c4f234db3`.
- Change: Added the unbound `chat.newLocalContinueWorkspace` action, labeled
  Chat: New Local (Continue Workspace) in Keybindings and the command palette.
  It opens the current project's draft with the source thread's branch and checkout path.
  Draft sources also carry their workspace mode and start-from-origin choice.
  Without a current thread or draft, project defaults apply. Ordinary New Local is unchanged.
- Reason: Starting another chat in the same worktree should not require selecting it again.
- Scope: Shared command catalog, web and desktop shortcuts, command palette, and draft creation.
  Native mobile has its own command palette and does not expose this configurable action.
  Provider adapters, server creation, and connection transports are unchanged.
- Verification: 233 focused draft, shortcut, Settings, action, and contract tests passed,
  plus the web typecheck and targeted lint. Tests cover new and reusable drafts, local and
  detached checkouts, draft workspace choices, remote environment context, and Cmd+N precedence.
  An isolated dev Browser panel pass verified command-palette launch, assigning Cmd+N in
  Settings, worktree inheritance through Cmd+N, empty-draft reuse, local-checkout continuation,
  and creation from a draft containing an unsent prompt without losing that prompt.
  Ordinary New Local still selected project defaults. No installed desktop app or provider
  turn was used; the live database was only read to seed the isolated stopped-thread snapshot.

## 2026-10-17 - Shared sidebar cards by workspace

- Upstream baseline: `da7c4f234db3`.
- The current web and desktop sidebar groups threads with the same environment, physical
  project, and workspace inside each section except Settled. Singletons retain their existing
  layout. Workspace changes regroup threads automatically. A shared card has one project and
  workspace header, one branch footer, and individual rows with their own metadata and actions.
  Hover replaces a grouped row's metadata with its actions. Selection keeps the existing gestures.
  Right-clicking a workspace card's shared header or footer replaces the selection with that
  card's current threads and opens the existing bulk actions menu. Other cards and sections
  remain outside the selection; a thread row retains its normal context menu.
  Header hover reveals Snooze and Settle controls for every thread in the card, including
  Postponed cards. Grouped rows retain the same Settle label as individual cards. Header actions
  reuse bulk snooze and settle handling for navigation, Undo, and failures.
  Postponed thread cards, grouped rows, and workspace headers show a leftmost up-arrow
  Un-postpone action. Workspace headers use the individual thread action for each current
  card member so underlying snooze or settlement clears first.
  Active thread cards, grouped thread rows, and workspace headers show a leftmost down-arrow
  Postpone hover action. Workspace headers postpone only their current active members.
  These actions recheck section and permission, preserve unrelated selections, and reuse
  existing postponement and forward navigation. Other sections do not show the new action.
  Right-click menus use the same down and up arrows wherever Postpone and Un-postpone
  already have icons. Bulk menus and native desktop menus retain their existing icon policy.
  Grouping mode adds four pixels between cards to distinguish cards of different heights while
  keeping each card's thread rows joined. Workspace cards and individual cards have no border.
- Settings > Fork > Group threads by workspace controls the behavior and defaults on. The
  preference stays on the device. Turning it off restores separate cards and the saved order.
  Fork settings, navigation, and search are also available in development builds so the
  controls can be tested before packaging. Mobile and the legacy sidebar keep their layouts.
- Grouping is a client presentation change. A small sidebar helper owns workspace identity and
  ordering. Threads remain direct list children with the existing handlers for selection, drag,
  file drops, rename, and actions. No thread, workspace, or server state is merged.
- Verification: 424 focused grouping, sidebar, settings, and contracts tests passed. Targeted
  lint, web/mobile/desktop/contracts typechecks, and the production web build passed. The
  authorized browser pass used an isolated copy of stopped-thread data. Verified workspace
  split/rejoin, toggle persistence across reload, hover metadata replacement, range selection
  across single cards and grouped rows, draft styling and discard, drag reorder, pin/unpin,
  postpone/un-postpone, snooze/wake, and unchanged Settled rows. Working used restored
  browser-only status fixtures with one and two threads, without starting agents. Light and
  dark layouts had no horizontal overflow at the sidebar's minimum width. The real Fork
  settings, navigation, and settings search passed in the ordinary development app, including
  toggling workspace grouping both ways. Focused settings tests, lint, and the web typecheck
  also passed after making these controls available in development.
  Screenshots and a short drag recording were retained outside the repository. No product
  defect was found in these flows. Native desktop and mobile UI were not exercised. The
  isolated dev instance remains available for inspection. The card context menu addition
  passed 48 focused membership, selection, and postponed tests, targeted lint, and the web
  typecheck. The browser pass verified header/footer bulk menus, replacement of an outside
  selection, and unchanged individual thread menus without running bulk actions. Header hover
  actions passed 197 focused tests, targeted lint, and the web typecheck. Browser checks on three
  disposable fixture threads verified group Snooze and Settle in Active and Postponed, visible
  row Settle labels, and an untouched thread in another workspace. Live data and installed builds
  were not changed.
  The header Un-postpone addition passed 23 focused grouping, postponed-menu, and restoration
  tests, targeted lint, and the web typecheck. An isolated Browser-panel pass verified the
  Un-postpone hover icon, restoration of all three epic-12 threads, an unrelated thread staying
  postponed, unchanged chat navigation, and persistence after reload. The narrow sidebar had
  no horizontal overflow. No provider turn was sent.
  The Postpone hover addition passed focused grouping and postponement tests, the Sidebar
  React Compiler check, targeted lint, and the web typecheck. An isolated Browser-panel pass
  verified individual cards, grouped rows, whole-card postponement, the Postpone tooltip,
  restoration, forward navigation, and an untouched thread in another workspace.

## 2026-10-17 - Worktree labels, named directories, and local colors

- Upstream baseline: `da7c4f234db3`, merged from fork `9a1a98c554` after initial implementation.
- Change: The web and desktop Workspace picker accepts an optional directory name and color
  on the existing New worktree row. Color selection works with an empty name and follows
  automatic directory naming. In a new-thread draft, focusing the name or opening the color picker
  selects New worktree. Valid edits save without closing the picker and remain after dismissal.
  Existing-thread workspace edits still require explicit selection before creating a checkout.
  Opening focuses the selected workspace row, or the name editor when named creation is active.
  Existing worktrees stay in directory order when selected. The New worktree selection
  covers its full row while name and color editing keep the menu open.
  The details panel shows every assigned worktree as a colored soft pill below the branch,
  with a worktree icon beside the pill and in the top workspace row. Web and desktop
  breadcrumbs show project / worktree pill / thread, and sidebar project labels use the
  same pill. Settled and compact rows prefix their thread title with the worktree pill.
  Sidebar card and search-result tooltips show the worktree pill on its own row below the branch.
  Pills always show the current directory name. First-prompt naming moves automatic directories
  before setup or agent work starts and updates thread paths. Explicit directory names stay put.
  Unsaved colors default to gray, which is also available in both color pickers.
  Static worktree branch naming defaults to an empty prefix across clients. Explicitly
  saved prefixes remain unchanged; resetting the prefix selects no prefix.
  Main checkouts and drafts awaiting a worktree have no pill in these locations.
  Clicking a pill opens Rename worktree. Every pill has Rename worktree and Change worktree in its
  own context menu; Change worktree opens a centered dialog with the current checkout selected.
  Closing either pill dialog after pointer activation does not refocus its pill or reopen the
  sidebar tooltip.
  Keyboard-opened editors return focus to their triggering pill.
  The details panel uses the same interactive pill as the sidebar and
  breadcrumb. Thread context menus retain Edit workspace below Rename thread for both local and
  worktree threads.
  Threads in the project's root checkout show Local checkout in that same row, with the existing
  folder icon and access to workspace editing. Drafts awaiting a new worktree do not show that label.
  Existing-thread selection adopts the destination checkout's actual branch; named creation
  uses a same-named new branch based on the thread's original branch. Workspace edits require
  an explicit name for new worktrees, while draft creation keeps the automatic-name option.
  The creation row retains its normal appearance when the name is empty; clicks and Enter
  cannot create a worktree until a required name is supplied.
  Existing-thread changes use the same modal presentation as Rename worktree. Choosing a
  destination only updates the dialog's selection. Cancel, Escape, and outside clicks discard
  unsubmitted changes. The composer keeps its anchored picker and existing dismissal behavior.
  Only the selected thread moves, through the normal metadata update and provider-session detach.
  Selecting a different checkout or creating a worktree shows its destination and explains that
  files and uncommitted changes stay in the original checkout. The footer's Change worktree button
  applies the move without opening a second confirmation. The current checkout cannot be submitted.
  Manual moves require an idle thread and compare its original branch and path on the server.
  The picker's Rename action retains the shared color and directory editor for every thread
  using that checkout.
  Sibling directory checks disable colliding names, and server rejections
  preserve the draft. Stopped worktrees can be renamed while active in the client; running
  agents disable pill actions and workspace editing. Editors already open lock their name, color,
  and submit controls until the run stops. Context-menu requests recheck the thread after selection.
  Successful moves
  update live, archived, and draft thread paths. Failed reference updates can be retried
  without moving the directory twice. Directory listings refresh on opening and after moves.
  Assigned worktrees that Git no longer recognizes show an unavailable-checkout error instead
  of Initialize Git. Their named-worktree pill stays visible independently of Git status.
- Reason: A useful directory name must exist before checkout and setup scripts run. The launch
  passes an optional `directoryName` through the existing worktree creation service. Git branch
  generation stays independent for explicit directory names. Automatic directories move only
  before setup or provider work starts; cancellation cleanup follows the moved path.
- Scope: `namedWorktreeStore.ts` owns fork-only localStorage choices and colors, scoped by
  environment, project, and actual path. Named-worktree metadata needs no database migration.
  Worktree labels derive from current thread metadata, independently of saved creation choices.
  Existing directories appear with the default color on clients without saved metadata.
  Reuse-list eligibility remains separate from pill visibility. Automatic directories stay out
  of the reuse list unless selected or carrying a saved color, preserving the existing policy.
  `ThreadWorkspaceMenu.tsx` owns existing-thread dialog requests and selection. It composes
  the existing Git creation, status, and metadata commands without adding a separate workspace API.
  The composer and dialog share workspace queries and reuse-list rules through `useWorkspaceChoices`.
  Manual directory renames preserve local colors, and manual removal forgets them.
  Generic color presets and soft-pill components belong to worktree labels. The former tag
  feature is retired across clients and server code.
- Verification: The optional-name color fix passed 17 unit tests, 35 Chromium tests, the web
  typecheck, and targeted lint. It covers color selection without a name, clearing an entered name,
  gray defaults, persistence, and preserving color through automatic directory naming.
  An isolated Browser-panel test with Personal GPT-6-Luna at low effort verified the gray default,
  selected teal without a name, and created a real worktree in a disposable repository. All three
  worktree labels retained teal after automatic directory naming and a page reload.
  Draft editing also selects New worktree on name focus or color-picker opening, saves valid edits
  without closing the menu, and preserves input focus. Browser tests cover dismissal and reopening;
  an isolated client pass verified name editing and a color-only choice after clicking away.
  Pill clicks open Rename worktree, and their context menu opens the change dialog through Change
  worktree. Focused browser tests cover both actions without activating the parent thread;
  an isolated client pass verified sidebar, breadcrumb, and details-panel pills.
  Rename-dialog focus behavior passed 16 focused Chromium tests, the web typecheck, and targeted
  lint. The running isolated client verified pointer dismissal in the sidebar and breadcrumb,
  plus keyboard focus restoration after Escape.
  Change worktree now receives the same trigger-specific focus setting. The combined dialog
  regression pass covered 38 Chromium tests, web typecheck, and targeted lint. The running client
  verified Escape dismissal from sidebar and breadcrumb context menus and keyboard focus return.
  Before fork integration, all 76 focused worktree browser tests and 105 color, display, packaging,
  and desktop identity tests passed, along with the web typecheck and targeted lint.
  Busy-thread restrictions passed 85 focused browser tests and 158 toolbar, context-menu, color,
  and display unit tests. Web typecheck and targeted lint passed. An isolated Personal GPT-6-Luna
  run verified all three pills stay disabled during execution and unlock after completion.
  The centered change dialog passed 72 focused Chromium tests, the web typecheck, and targeted
  lint. The already-running isolated server verified the matching blurred backdrop, cancellation,
  a move to the local checkout and back, and the composer's anchored picker without a backdrop.
  The all-worktree pill and automatic-directory naming follow-up passed 186 focused
  web unit tests, 89 launch-service tests, 54 Chromium tests, nine React Compiler checks, and web
  and server typechecks. Real Git fixtures cover directory moves, occupied destinations, and
  live and archived thread references. Additional cases cover shared active runs, cancellation,
  retries, light gray selection, and rendered pill updates. Targeted lint passed with one existing
  optional-chaining warning in the launch tests. The isolated Browser-panel pass used Personal
  GPT-6-Luna at low effort. It verified a real automatic-directory move, all three pill locations,
  explicit directory preservation, matching colors, reload persistence, both gray swatches, and
  workspace-picker entry points. Git and the isolated database agreed on the new path, and the
  temporary directory was gone. The confirmation follow-up passed 36 focused Chromium tests,
  web typecheck, compiler coverage, and lint. Isolated client checks exercised Proceed and Cancel
  for local, existing, and new checkout selections, creation only after approval, and an uncommitted
  file remaining in its original checkout. No installed-client test ran.
  Earlier scoped web, server, contracts, and client-runtime typechecks and targeted lint
  passed. Picker DOM tests, persistence tests, launch forwarding, real Git worktree creation,
  branch renaming, collisions, and automatic named-directory cleanup passed. The full touched
  server test files also reported two failures in unchanged tests, unusual diff paths and expired
  artifact/log cleanup. An isolated browser pass with Personal GPT-5.6-Terra at low reasoning
  verified named and unnamed creation, setup's initial working directory, generated branch
  renaming, color persistence after reload, reuse, directory renaming, and removal with the
  branch retained. No live database writes or desktop install was used.
  After the upstream merge, 261 focused tests and all four scoped typechecks passed.
  Targeted lint passed with one existing warning. Picker tests use Chromium and the
  upstream React Compiler; real Git tests cover direct creation and automatic cleanup.
  Dropdown focus and the details label passed the scoped web typecheck, targeted lint,
  and 101 toolbar logic tests. All 20 Chromium tests passed across
  the workspace focus, creation row, and panel suites, covering selection focus, keyboard
  navigation, name and color editing, and named-directory visibility and color.
  An isolated dev Browser panel pass verified all four selected workspace states and the
  named-worktree label below the branch, including hiding it for automatic worktrees.
  The follow-up pass verified stable worktree positions, selection in the existing list,
  and the full-width creation highlight with named-input focus preserved.
  Pill integration passed 159 focused unit tests, 30 Chromium tests, scoped web typecheck,
  and targeted lint with three existing unused-import warnings in sidebar logic tests.
  The Browser panel verified matching default and custom colors across the panel, breadcrumb,
  and sidebar, the restored worktree icon, and absence of pills for local and automatic checkouts.
  Shared-editor verification passed 118 focused unit tests and 36 Chromium tests covering
  collisions, server rejection, color-only saves, running-thread guards, and reference-update
  retries. The isolated Browser panel verified all three pill entry points, disabled collision
  submission, real directory moves and restoration, custom-color updates, unchanged branch
  names, draft path updates, and sidebar clicks that preserve the current conversation.
  Rename-menu verification passed 49 focused unit tests, six Chromium dialog tests,
  scoped web typecheck, and targeted lint. The Browser panel verified both right-click
  entry points, matching pencil icons, the dialog title, and no worktree action on local
  or automatically named checkouts.
  Tooltip pills passed the scoped web typecheck and sidebar lint. The isolated Browser panel
  verified their placement below the branch, color, editor entry point, and absence on local and
  automatic checkouts.
  The unavailable-checkout guard passed 83 focused Git-action tests, web typecheck, and lint.
  The isolated Browser panel verified the error and retained pill for a missing checkout,
  and normal Git controls for a healthy checkout. Automated panel browser tests still hit
  the existing mocked-project fixture failures in this checkout.
  Existing-thread workspace editing passed 190 focused tests and all four scoped typechecks.
  Targeted lint passed with one existing server warning. The isolated Browser panel verified
  sidebar and breadcrumb pills, Edit workspace on a local thread, the panel arrow, selected-row
  focus, same-named branch creation from the original branch, actual-branch adoption, moving
  back to the root checkout, and directory renaming through the existing editor. Other threads
  kept their checkout assignments. Automated Chromium suites still have mocked-state fixture
  failures in this checkout; the creation-row suite and picker focus cases passed.
  Required-name editing passed 15 controller tests, eight Chromium creation-row tests,
  scoped web typecheck, and targeted lint. The isolated Browser panel verified that typing
  allows creation and clearing the name blocks it while the row and editor stay usable.
  Standalone dismissal passed five focused Chromium checks, scoped web typecheck, and targeted
  lint. The isolated Browser panel reproduced pointer-leave dismissal from a breadcrumb and
  verified that both breadcrumb and details-panel editing remain open after pointer leave.
  Dismissal discarded an entered name without changing the selected checkout. The Cancel footer
  was removed; the focused dismissal checks still pass using Escape and outside clicks.
  The Local checkout row passed scoped web typecheck and targeted lint. The isolated Browser
  panel verified its folder icon, dropdown arrow, picker access, and selected local checkout;
  the named-worktree pill still renders on a worktree thread.
- Upstream conflict map: Preserve the optional directory-name field in contracts, client launch
  forwarding, and `ThreadLaunchService`, including automatic-directory naming before setup;
  path validation and initial path choice stay in
  `GitVcsDriverCore`. The picker row, palette, and metadata store are separate fork-owned modules.
  `BranchToolbar`, `WorkspaceMenu`, and the first-send bootstrap in `ChatView` are the web seams.
  Existing-thread editing adds only the optional idle guard to metadata updates in contracts,
  client command forwarding, and the orchestrator; automatic provisioning does not opt into it.

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

## 2026-10-11 - Integrate upstream through ed0f7b908b

- Upstream baseline: `ed0f7b908b`, 95 commits since `a11f464133`.
- Change: Integrate on `integration/upstream-2026-10-11` from fork commit `391ea6f102`.
  Resolve seven conflicted files while preserving thread-tag authorization, replay layers and
  exports, legacy fork default-model migration, usage-account exclusion, side chats, and Fork
  settings search. Adopt upstream's shared attachment-only prompt. Complete a new PR test's
  shortcut context and compare canonical paths in the incoming Pi usage-discovery test on macOS.
- Adoption audit: No retained fork feature is fully replaced. Upstream worktree-launch safety
  and queue handling complement workspace management and completed-subagent busy classification.
  Claude workflow stopping and OpenCode stop recovery do not replace server-resolved Stop
  targeting beyond paginated history or late Codex terminal-handle tracking. Source-control
  settings migration retains the fork's legacy default-model migration. Model-preference sync
  does not replace account-level usage exclusion. Side chats, transient history cleanup,
  selected-text actions, tags, postpone, scoped thread references, sidebar hover, custom
  shortcuts, visualization links, wrapped tables, and Fork identity remain downstream behavior.
- Verification: Frozen dependency installation, 2,144 focused tests in 66 suites, nine scoped
  typechecks, server and web source builds, targeted lint, and formatting passed. Diff checks pass
  outside upstream dependency-patch context whitespace. Three settings symlink-watcher tests
  required a rerun outside the sandbox. Lint retains existing warnings in large UI files.
  An isolated Browser panel pass with 21 copied, stopped threads verified Personal/Terra
  low-effort turns, Stop after provider settlement, colored tags and reload persistence,
  F2 rename, side-chat context reads and selected-text reuse with composer focus, native
  transient-history deletion with parent history preserved, postpone and both restoration
  paths, `%` and `%%` references and literal percentages, Cmd+W and Undo, prompt navigation,
  current and legacy sidebar rendering, account usage exclusion, worktree rename, dirty-removal
  cancellation, visualization-marker links and HTML source/rendered views. A 900-pixel
  viewport had no page overflow. No product regression was found in these exercised flows.
  Six focused Stop regressions passed. Removing only fork terminal-handle tracking during
  test transformation made both late-handle cases fail because no native termination was sent.
  Removing the server-resolved client path restored its paginated-history lookup and failed
  the empty-history regression. These controls did not edit the running app's source.
  The isolated title-generation preference required a separate correction to Personal/Terra;
  it initially retained upstream's Astra default. The dev server and Browser panel remain
  available for inspection. Installed desktop, native mobile, remote clients, and installer
  behavior were not run. Nothing was published, and live data was read only.

## 2026-10-10 - Personal provider for live tests

- Upstream baseline: `a11f464133`.
- Change: Live tests must use the ChatGPT `Personal` provider instance. Other accounts and
  provider fallback are forbidden. Test turns explicitly select Personal and Codex Terra with
  low reasoning effort.
- Reason: Keep test usage on the maintainer's personal subscription.
- Scope: Fork development and verification instructions, including side chats and MCP tests.
- Verification: Confirmed `codex_personal` in the live provider catalog. The isolated dev
  configuration enables only Personal. Instructions passed formatting and diff checks.

## 2026-10-17 - Retire thread tags

- Upstream baseline: `da7c4f234db3`, merged into the named-worktree branch.
- Change: Remove thread tag UI, keyboard and palette actions, subscriptions, RPC contracts,
  server storage, and inheritance across web, desktop, and mobile. Named-worktree labels keep
  the generic soft-pill components and palette without depending on tag code.
- Reason: Named worktrees identify the working directory and replace the separate thread label.
- Scope: Existing tag sidecar files remain untouched. Obsolete inheritance effects need a separate
  one-time cleanup so old outbox payloads do not require a tag decoder. The original fork migration
  63 was removed on October 19 because its ID collided with upstream. Thread messages, worktree
  metadata, and unrelated queued provider effects remain unchanged.
- Verification: All six changed packages passed scoped typechecks. Focused suites passed
  397 unit/server tests and 26 Chromium tests. Chromium tests ran against an identical temporary
  web-source copy because Vitest's browser mocks fail under the checkout's spaced path.
  Targeted lint passed with existing warnings. The isolated Browser panel verified both context
  menus, the worktree dialog and palette, and absence of tag commands from the command palette.
- Upstream conflict map: Preserve the removed tag entry points when merging. The palette now
  lives in `softPillColors.ts`. Databases that recorded `63 / RemoveThreadTagEffects` need the
  separately executed history correction in the fork guidelines before upstream's 63 can run.

## 2026-10-10 - Integrate upstream through October 10

- Upstream baseline: `a11f464133`, 207 commits since `5e2225671f`.
- Change: Integrate upstream's provider and usage package moves, HostProcess services,
  thread search, sortable panel tabs, and the remaining incoming changes. Preserve the
  fork's side chats and transient cleanup, postpone, `%` and `%%` references, workspace
  management and busy rules, sidebar hover, custom shortcuts and prompt navigation,
  visualization links, wrapped tables, branding, usage-account exclusion, and Stop fixes.
- Reason: Keep the fork current while retaining behavior upstream does not yet replace.
  Upstream `4daec109cd` now owns the identical SQLite pairing-scope fix. Upstream's usage
  fixture lifetime fix replaces the extra fork persistence wait in the price-race test.
- Scope: Resolve 14 conflicts on an isolated integration branch. Move the transient-history
  deletion error into provider-core so the extracted adapter contract does not depend on
  server code. Adapt cleanup to OpenCode's settings/runtime package and Effect environment
  merging. Keep Mod+T for side chats, incoming thread search and tab dragging, live chat tab
  titles, and legacy fork default-model migration. Usage exclusion filters raw instance
  configuration before upstream's provider schema decoding.
- Verification: Frozen dependency installation, scoped server, web, desktop, mobile,
  contracts, shared, client-runtime, provider-core, and OpenCode typechecks, server and web
  bundle builds, targeted lint, and formatting passed. The focused feature checks passed
  2,162 tests. One Git review-diff rename/statistics test fails identically in a separate,
  untouched `a11f464133` checkout. Three settings symlink-watcher tests passed outside the sandbox.
  Diff checks pass apart from unchanged whitespace in upstream's React Native WebView patch.
  An isolated dev-server Browser panel pass with copied, stopped thread history verified
  pairing, project creation, low-cost Codex Terra turns, incoming thread search and match
  cycling, side-chat context reads, live titles, native transient-history cleanup, postpone
  and restoration through the banner and sidebar, `%` and `%%` references, literal percentages,
  table wrapping, reload, and a 900-pixel viewport without page overflow. Stop terminated a
  background command after its provider turn completed and persisted its interrupted status.
  Codex initially selected the globally configured MCP server for a side-chat read; selecting
  the dev app's injected `t3-code` server returned the owning thread correctly. Installed
  desktop, native mobile, and remote connections were not run. The main checkout, `fork`
  branch, installed app, and live data were unchanged.

## 2026-10-08 - Add a selectable H3 wordmark to the Fork sidebar

- Upstream baseline: `5e2225671f`.
- Change: Settings > Fork has a device-local "Use H3 wordmark" toggle, enabled by default.
  Turning it off restores T3 in the sidebar. The width probe follows the same preference,
  settings search finds the toggle, and restoring device defaults enables H3 again.
  The Fork pill shares the wordmark's text baseline. Other stages keep the upstream T3 wordmark
  and centered pill layout.
- Reason: Make H3 branding optional without changing the desktop app's identity.
- Scope: Fork settings, client settings persistence, and the shared sidebar brand. App names,
  icons, onboarding, chat marks, desktop identity, and data paths are unchanged. Native mobile
  accepts the additive client preference but does not expose the desktop wordmark toggle.
- Verification: All 333 focused settings, persistence, search, and packaging tests passed.
  Web typecheck, formatting, and targeted lint passed, with existing lint warnings in the
  settings panels. An isolated dev client with a browser-only Fork branding fixture switched
  between H3 and T3 in both themes, retained T3 after a full reload, found the toggle through
  settings search, and restored H3 through both the row reset and device-default reset.
  The visible header and width probe matched. Saved Browser panel screenshots are blurred,
  so this pass verified DOM state and computed styles rather than screenshot appearance.
  A follow-up alignment pass measured matching wordmark and pill text baselines for H3 and
  T3 in light and dark themes at 14, 16, and 20 px interface sizes. Narrow headers still clip
  the pill's wrapped line.

## 2026-10-08 - Add Forge artwork to the Fork header

- Upstream baseline: `5e2225671f`.
- Change: The shared web and desktop sidebar header displays the selected Forge artwork in
  light and dark themes. It retains normal theme colors for the wordmark and controls. The Fork
  pill uses a translucent theme-colored fill and a thin border instead of an opaque secondary
  background. Artwork, Pill, and None remain the existing visibility choices. The neutral overlay
  also works with custom palettes, which otherwise fall back to the pill.
- Reason: Give the fork the chosen visual identity without replacing upstream stage artwork
  or adding another customization setting.
- Scope: A fork-owned header component and artwork assets, a narrow sidebar header integration,
  and the identification settings hook. Both current and legacy sidebars share the header.
  Native mobile, providers, server contracts, authentication artwork, and update tracks are unchanged.
- Verification: All 31 focused settings, stage-artwork, and composer tests, web typecheck,
  targeted lint, formatting, and diff checks passed. A disposable production web build bundled
  both artwork files. Lossless WebP encoding preserves visible pixels and transparency while
  reducing asset size. An isolated dev-server Browser panel pass with a browser-only Fork branding
  fixture confirmed the pill's light and dark computed styles and artwork switching. Saved
  screenshots were blurred, and the panel disconnected before the settings interaction check.
  The installed app and live data were unchanged.

## 2026-10-08 - Fit wrapped Markdown tables to the chat width

- Upstream baseline: `5e2225671f`.
- Change: Wrapped tables allow headers and cells to shrink to the available chat width.
  Enabling wrapping no longer preserves the unwrapped column widths. The existing word-wrap
  preference and per-table toggle still control wrapping, and unwrapped tables retain scrolling.
- Reason: Ordinary two-column tables required horizontal scrolling even with wrapping enabled.
- Scope: Shared web and desktop Markdown renderer and table CSS. Native mobile uses a separate
  renderer. No provider, server, connection, or wire-contract changes.
- Verification: All 74 focused Markdown tests, web typecheck, formatting, and diff checks passed.
  Targeted lint passed with existing warnings in unrelated code. Browser verification against
  isolated dev state passed for the reported table, long headers, identifiers, URLs, and the wrap
  toggle. Wrapped two-column tables fit 728, 600, 320, and 160 pixel containers; twelve-column
  tables retained scrolling when narrower than their minimum content width. The viewport resize
  tool timed out, so narrow-width checks temporarily resized the Markdown container instead.
  Recheck wrapping after upstream changes to the table CSS or toggle.

## 2026-10-08 - Integrate the October 8 nightly

- Upstream baseline: `5e2225671f`, release `v0.0.46-nightly.20261008.2819`.
  The integration branch brings in 302 commits since `efecd3cf8b`.
- The pre-merge feature audit retired the launch permission patch and retained the remaining
  downstream behavior. The adoption entry below records full and partial upstream overlap.
- Merge adaptations cover Effect 4 import and service changes, RPC permission maps, the shared
  composer and panel APIs, and provider runtime layers. The workspace menu retains upstream's
  environment picker. Side chats honor the new orchestration permission checks.
- Server-resolved Stop also clears idle-thread PR watches. Reopening a closed panel restores
  existing side chats but skips transient chats whose history cleanup runs on close. The new panel
  menu remains configurable while Mod+T keeps opening a side chat by default.
- Live verification restored the panel workspace's copy-path context menu, which the shared
  workspace popup dropped during integration. Pairing binds the optional-scope predicate as a
  SQLite integer because the incoming boolean parameter prevented fresh browser pairing. The
  incoming usage price-race test now awaits cache persistence before removing its fixture directory.
- Verification: Frozen dependency installation, scoped server, web, desktop, mobile, contracts,
  shared, and client-runtime typechecks, source bundle builds, and targeted lint passed. Focused
  checks across every retained fork feature passed: 1,624 tests in 59 suites. One incoming Git diff
  statistics test still fails identically in an untouched nightly checkout. Three symlink-watcher
  tests failed inside the sandbox and passed outside it.
- Browser verification used a disposable home, stopped-thread snapshot, and two temporary Git
  projects. It covered side-chat creation, focus, owning-thread context, transient native-history
  cleanup, persistent close/reopen and sidebar roles; selected-text citation, new-thread, reuse and
  replacement cancellation; `%` and `%%` references; project filters and scoped new threads;
  rename, postpone and restoration; workspace rename and dirty-removal cancellation; custom
  shortcuts, repeated prompt navigation, and hover reveal in current, legacy and Settings sidebars.
  Account exclusion persisted and changed Cost and Tokens while another included instance retained
  shared history. Upstream inline HTML rendered alongside fork visualization links and wrapped
  tables. A low-effort Codex Terra command remained active after its reply, then Stop terminated
  its recorded PID. Synthetic Codex and OpenCode native-history deletion tests also passed.
  Packaged desktop, native mobile, remote/tunnel connections, and live Claude turns were not run;
  their relevant shared logic, contracts, typechecks and packaging checks were covered.

## 2026-10-07 - Release worktrees after subagents finish

- Upstream baseline: `efecd3cf8b`.
- Web and desktop workspace pickers ignore idle and terminal subagents when determining busy
  status. Unsettled conversations, including user forks, still reserve their assigned worktree.
  Queued and executing turns block rename and removal even on settled or archived threads.
- Reason: Completed Codex review children remained unsettled after their parents were settled.
  The sidebar hides these children, but the workspace picker counted them as busy indefinitely.
- Scope: Workspace row classification and its shell-state adapter. No server, database, wire
  contract, provider adapter, or native mobile changes.
- Verification: All 102 focused toolbar tests, web typecheck, targeted lint, formatting, and
  diff checks passed. Seven false-busy regressions fail with the original predicate.
  The installed app and live database were unchanged. Browser verification was not performed.

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

## 2026-10-08 - Adopt upstream launch permission checks

Upstream `2f85686d9d`, included in nightly `5e2225671f`, replaces the fork's
`t3_thread_launch` permission patch completely. `McpToolAccess.startsThreads` checks caller
liveness, inherits runtime and interaction modes, and rejects escalation before the launch
handler runs. The fork handler, descriptions, and duplicate tests were retired before integration.

The pre-merge audit found partial overlap in provider usage filtering, terminal-worktree cleanup,
Stop recovery, inline HTML rendering, and right-panel shortcuts. These do not replace account-level
usage exclusion, workspace-picker busy classification, server-side Stop targeting and late Codex
terminal handles, visualization-marker parsing, or side chats. Those fork implementations remain.
Upstream's new panel-menu command remains configurable; the fork's side-chat shortcut keeps Mod+T.

## 2026-10-06 - Postpone threads without a timer

- Upstream baseline: `efecd3cf8b`.
- The current web and desktop sidebar has a Postponed section with normal thread cards,
  single and bulk Postpone thread and Un-postpone thread actions, and a remembered collapse state.
  Parking menu labels follow the sibling Settle/Un-settle wording, with separate bulk action counts.
  Postponing active cards is available through their menus. Postponed cards retain Settle and Snooze
  actions and have a rightmost return-arrow action to un-postpone,
  using the same icon as Un-settle.
  Postponed cards and grouped rows can be dragged into a composer to insert a thread-link chip.
  These drags leave postponement intact and cannot move or reorder threads within the sidebar.
  Verification passed 225 focused sidebar tests, targeted lint, and the web typecheck. An
  isolated Browser-panel pass verified grouped and individual postponed sources, correct chip
  links, unchanged active-thread dragging, and no sidebar move after a cancelled reference drop.
  No provider turn was sent.
  Successful lifecycle actions clear postponement through the shared thread-action hook, including
  Cmd+W and header menus. Settle remains available after automatic server settlement, and Undo
  restores the original postponement snapshot after Settle, Snooze, or Unpin.
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
- Verification: 419 focused storage, restoration, action, permission, menu, sidebar and keybinding
  tests passed. Web typecheck, formatting and diff checks passed. Targeted lint has no errors;
  existing large UI files report warnings.
  An isolated dev-server Browser panel pass confirmed the menu labels, hover actions, direct
  postpone/un-postpone round trip, matching overlay positions, and Cmd+W moving the thread to Settled and
  opening a draft. The Browser host disconnected before hover-settle, Snooze, and Undo could be
  confirmed. Native-client
  verification was not performed.

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
  the picker open. Embedded percentages such as `100%` do not open it. Both scopes exclude
  subagent threads while retaining ordinary forks.
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
- Subagent exclusion verified on 2026-10-13 with 16 picker tests, web typecheck, and targeted lint.
  An isolated Browser panel pass checked both scopes, searches, and reference selection in existing
  and new-thread composers with copied subagent metadata and an ordinary fork fixture.

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

## 2026-10-17 - Integrate the reviewed upstream snapshot

- Upstream baseline: `da7c4f234db3`, following `ed0f7b908b2e`. Integrates the 775 reviewed
  upstream commits on `t3/review-upstream-feature-changes`, starting from fork commit
  `11ae5e35f83c`. Shared branches and published artifacts are unchanged.
- Adopted upstream's viewport height limit for fallback context menus. Removed the fork's
  equivalent height calculation. Upstream worktree retention rules complement the fork's
  workspace chooser, reuse, and rename actions, so those controls remain.
- Preserved side chats, selected-text chat actions, transient provider-history deletion,
  thread references and tags, postponed threads, project navigation, custom shortcuts,
  usage exclusions, appearance settings, and Fork desktop identity. Side chats now use the
  extracted upstream panel renderer and close hook. Provider selectors read the upstream
  provider catalog rather than the retired server-config field.
- Adapted fork handlers to React Compiler, retained upstream's smaller sidebar subscriptions,
  and migrated the fork's rendered React tests into upstream's headless-browser projects.
  Canonical temporary roots keep macOS filesystem fixtures consistent with Git and realpath.
- Verification: 203 focused Chromium tests, 89 compiler coverage cases for fork source files,
  1,168 focused web unit tests, and 397 contracts/shared/client/packaging tests passed.
  Focused server checks cover provider startup, transient deletion, tags, authorization,
  workspace rename, retention, and usage. Two existing symlink-target settings watcher tests
  still time out on macOS; their watcher implementation is unchanged by this integration.
  Scoped web, mobile, desktop, server, contracts, shared, and client-runtime typechecks,
  targeted lint, and web/server bundles passed.
- The authorized integrated browser pass used an isolated copy of stopped-thread data.
  Personal with Codex Terra at low effort completed main and side-chat turns. Verified tag
  saving, a scrolling context menu in a 400px viewport, side-chat rendering, temporary-thread
  cleanup, removal of its native provider history, and preservation of the main thread.
  No native device or installer checks were run. Nothing was published.

## 2026-10-17 - Verify all retained fork feature groups

- Upstream baseline: `da7c4f234db3`, integrated in `415aa0dfa4`.
- Extended the audit to every active feature group recorded in this journal. Another 709 focused
  tests passed, including MCP creation and tag inheritance, provider context, late Codex command
  handles, installed-provider deletion safety, desktop identity and menus, public Connect build
  defaults, mobile tag appearance, selection, references, and Undo notices. These supplement the
  earlier 203 Chromium cases, compiler coverage, focused unit tests, typechecks, and builds.
- The isolated browser pass verified tags and custom hex/RGB colors, reload persistence,
  postponed cards and notices, settlement/Undo restoration, restoration on a new message,
  existing-thread side surfaces, both sidebar indicators and parent navigation, transient
  side-chat creation and cleanup, owner-context reads, selected-text new-thread drafts,
  repeated side-chat citation reuse and focus, `%` and `%%` insertion, F2, project switching,
  filter clearing, Cmd+W for panels and settle/new, and first/last prompt navigation.
  Both sidebar layouts passed hover reveal and dismissal.
- A disposable Git repository verified worktree rename, reuse, current-workspace guards, and
  refreshed dirty-file counts before force removal. Cancelling preserved the uncommitted file.
  Account usage inclusion toggled both ways in isolated settings and was restored. Automated
  usage tests cover shared directories and aggregate filtering.
- The real Fork header and settings ran in a browser-only component fixture. H3/T3 switching,
  reset, reload persistence, and light/dark Forge artwork passed. Wrapped tables fit 160, 320,
  and 600 pixel containers. Visualization markers became file links and opened the HTML fixture;
  rendered/source switching passed. The final chat page had no horizontal overflow.
- All live prompts in this extended pass used Personal with Luna at low reasoning effort.
  Background text-generation defaults used the same selection. Updated the current fork
  guidance to require cheap models, such as Luna or Sonnet, while preserving the Personal-account
  restriction. No other account ran a live turn. Credential-free Codex and OpenCode deletion
  fixtures used disposable homes; Claude cleanup and account filtering used automated fixtures.
- Limits: Native device access reports "Agent device access is turned off for this environment."
  Native mobile UI, the installed Electron shell, installers, and remote/tunnel connections were
  not exercised. Mobile appearance and desktop packaging behavior have automated coverage.
  The two unchanged upstream macOS symlink-watcher timeouts recorded above remain unresolved.
  No new product regression was found in the exercised fork behavior. Nothing was published.

## 2026-10-22 - Seal local macOS release bundles

- Upstream baseline: `da7c4f234db3`, integrated in `415aa0dfa4`.
- Local macOS packaging now explicitly ad-hoc signs the complete bundle, disables hardened
  runtime for that signing mode, and skips notarization. Developer ID builds retain their
  existing signing hook and entitlements.
- Electron-builder 26 skips signing when no identity is selected. The resulting fork artifact
  retained an invalid executable signature and macOS reported it as damaged. Packaging now runs
  strict, recursive bundle-signature verification before copying artifacts into the release
  directory. The release runbook requires verification of both the ZIP and DMG app copies.
- Verification: 88 focused packaging and desktop identity tests passed, including a real macOS
  fixture that verifies a sealed app and rejects a modified resource. The scripts type check and
  targeted lint passed. Ad-hoc signing does not provide Apple Developer ID trust or notarization.
