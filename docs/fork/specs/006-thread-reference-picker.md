# Thread Reference Picker Implementation Plan

## Status

Implemented as a fork-only web and desktop feature on 2026-08-11. Native mobile, contracts,
persistence, provider adapters, and desktop external-link handling remain unchanged.

## Overview

Add a low-maintenance `%` composer picker for referencing an existing T3 thread. The first release
is deliberately limited to web and desktop, where desktop inherits the web client. It inserts a
plain Markdown link into the composer and renders that link as a clickable thread chip after the
message is sent.

The feature reuses the client shell snapshot already loaded for the sidebar and the fork's existing
MCP thread-control tools. It adds no server query, transcript preload, orchestration contract,
database field, provider adapter, native mobile editor change, or external desktop URL handler.

## Desired User Experience

1. In the web or desktop composer, the user types `%` at a token boundary.
2. A picker opens immediately with recently updated threads from the composer's current
   environment.
3. Typing after `%` filters by thread title, thread ID, project title, or branch.
4. Selecting a thread replaces the active `%query` token with:

   ```text
   [Thread title](t3code://threads/<environment-id>/<thread-id>)
   ```

5. The composer intentionally displays that raw Markdown. It does not create a Lexical inline
   token or chip.
6. After the message is sent, the Markdown renderer presents the reference as a compact thread
   chip. Clicking it navigates to the referenced thread inside T3.
7. When the user asks the provider to inspect the reference, the provider extracts the thread ID
   and uses the existing `thread_status` or `thread_read` MCP tool. T3 does not automatically load
   or inject the referenced transcript.

## Fixed Product Decisions

| Area                      | Decision                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| Trigger                   | `%` at the beginning of the active non-whitespace token           |
| Clients                   | Web and desktop only in v1; mobile is explicitly unchanged        |
| Picker scope              | Active, non-archived threads in the current environment           |
| Current thread            | Excluded from picker results                                      |
| Default ordering          | `updatedAt` descending, then thread ID ascending                  |
| Result limit              | 20 rows after filtering and sorting                               |
| Search fields             | Thread title, thread ID, project title, and branch                |
| Stored text               | Ordinary Markdown in the existing user-message text field         |
| Canonical URI             | `t3code://threads/<environment-id>/<thread-id>`                   |
| Composer display          | Raw Markdown; no composer chip in v1                              |
| Sent-message display      | Clickable internal thread chip                                    |
| Missing target            | Use the existing route fallback, which normally returns to `/`    |
| Provider behavior         | Explicit MCP read on demand; never automatic transcript injection |
| External desktop links    | Out of scope; only in-app rendered links are handled              |
| Contracts and persistence | Unchanged                                                         |
| Provider adapters         | Unchanged                                                         |
| Feature setting           | None                                                              |

The URI includes the environment because `ScopedThreadRef` is the real client identity. A bare
`t3code://<thread-id>` puts the ID in the URL host, loses environment identity, conflicts with T3's
existing namespaced deep-link shape, and leaves no room for other T3 resources.

## What We Are Not Doing

- Adding thread references to `ChatAttachment`, orchestration events, or persisted projections.
- Loading thread details or transcripts when the picker opens.
- Injecting referenced thread contents into every provider prompt.
- Teaching individual Codex, Claude Agent, Cursor, Grok, or OpenCode adapters to rewrite prompts.
- Adding a `thread` variant to the shared composer inline-token parser.
- Adding a Lexical `ComposerThreadNode`.
- Changing the iOS or Android native composer bridges.
- Supporting the picker or rendered chip on mobile in v1.
- Registering a new desktop deep-link lifecycle or routing externally opened `t3code:` URLs.
- Adding fuzzy transcript search, archived-thread loading, pagination, or a feature flag.

These exclusions are maintenance boundaries, not deferred implementation steps. Reconsider them
only after the minimal feature has proven useful.

## Architecture

### 1. Fork-owned thread-reference helper

Add a small web-local module, `apps/web/src/threadReference.ts`, containing pure functions and
types for:

- Serializing a title and `ScopedThreadRef` into canonical Markdown.
- Parsing only canonical `t3code://threads/<environment-id>/<thread-id>` destinations.
- Escaping Markdown labels and percent-encoding both path segments.
- Rejecting credentials, extra path segments, empty IDs, query strings, fragments, and other
  `t3code:` hosts.
- Enforcing canonical spelling by decoding both path segments and requiring serialization of the
  parsed result to reproduce the original destination exactly.
- Filtering, sorting, and limiting already-loaded thread shells for the picker.

Keep this module web-local rather than adding a shared package export. Mobile does not implement
the feature in v1, and no server behavior needs the URI parser. This makes the new file entirely
fork-owned and avoids an upstream package-manifest conflict.

The picker helper accepts its dependencies as plain values:

```ts
interface BuildThreadReferenceOptions {
  environmentId: EnvironmentId;
  currentThreadId: ThreadId | null;
  query: string;
  threads: ReadonlyArray<EnvironmentThreadShell>;
  projects: ReadonlyArray<EnvironmentProject>;
}
```

It returns view data only: `threadRef`, `label`, and `description`. The description is the project
title followed by `#branch` when present. If a matching project shell is temporarily absent, retain
the thread and use its project ID as the description fallback. Search is case-insensitive substring
matching over the four fixed fields. An empty query returns the 20 most recently updated eligible
threads. The result cap is a module constant, not a configurable helper argument.

The Markdown label is a snapshot of the title when the reference is inserted. Renaming a thread
later does not rewrite old messages or add a live title lookup to message rendering.

### 2. Web-local `%` trigger

Do not widen `@t3tools/shared` for a web/desktop-only feature. Extend the web-local trigger type in
`apps/web/src/composer-logic.ts` so its `kind` is the shared kinds plus `"thread"`. Add `%` detection
beside the existing `$` and `@` token checks.

The trigger opens for a bare `%`. As with the existing triggers, whitespace ends the query. This
means typing a modulo operator may briefly open the menu when `%` is the active token; that is an
accepted v1 tradeoff.

### 3. Picker composition

In `ChatComposer`:

- Read the already-loaded, environment-scoped thread shells and projects only while the active
  trigger kind is `thread`; do not issue a request or subscribe the composer to global shell lists.
  A snapshot that does not refresh during the brief lifetime of an unchanged picker is acceptable.
- Build thread items only while the active trigger kind is `thread`.
- Add a `thread` member to `ComposerCommandItem` containing the target `ScopedThreadRef`.
- Use a message/thread icon and a `Threads` group label in `ComposerCommandMenu`.
- On selection, replace the trigger range through the existing `applyPromptReplacement` path and
  append one trailing space.
- Preserve the existing keyboard highlight, Enter, Tab, arrow-key, Escape, and focus behavior.

The current thread ID is `routeThreadRef.threadId` only when `routeKind` is `server`; do not derive
it from loaded thread detail, which can be absent while the route is loading. Draft routes pass
`null`, so a new draft can reference any eligible thread in its environment.

### 4. Safe sent-message rendering

The current Markdown sanitizer allows `file:` but not `t3code:`, and React Markdown's default URL
transform also removes unknown protocols. Update `ChatMarkdown` narrowly:

1. Permit `t3code` in the sanitizer's `href` protocols.
2. Preserve a `t3code:` destination in the URL transform only when the fork-owned parser accepts
   its exact canonical form.
3. Before the external-link branch, parse the normalized destination and render a dedicated
   `ThreadReferenceLink` when valid. If a destination starts with `t3code:` but is not canonical,
   render its label as plain text with no anchor.
4. Have `ThreadReferenceLink` render a TanStack internal link to the existing
   `/$environmentId/$threadId` route. Its actual DOM `href` must be the same-origin web route, never
   the custom protocol. This keeps ordinary, modified, and middle clicks away from desktop protocol
   handling.
5. Put the original canonical Markdown in `data-markdown-copy` so selecting and copying the chip
   preserves the stored thread reference rather than serializing the internal web route.
6. Never pass a `t3code:` destination to `shell.openExternal`, the integrated browser, or ordinary
   anchor navigation.

Put the chip presentation and navigation in a new
`apps/web/src/components/chat/ThreadReferenceLink.tsx` file. The `ChatMarkdown` integration should
remain a small protocol allow-list addition and one early renderer branch.

### 5. Provider recognition

The existing `thread.turn.start` command stores and forwards user message text unchanged, so the
canonical URI reaches the provider without a new contract.

Keep the convention in the fork-owned, provider-neutral thread-control tool metadata rather than
also changing Codex-specific developer instructions. Add concise wording to the existing
`thread_status` and `thread_read` descriptions:

> A `t3code://threads/<environmentId>/<threadId>` link references a T3 thread. URL-decode both path
> segments, confirm the decoded environment with `thread_context`, then pass only the decoded
> `<threadId>` to this tool.

All providers see the same MCP metadata. If the decoded URI environment differs from
`thread_context.environmentId`, the provider must report that the reference belongs to another
environment rather than reading a coincidentally equal local ID.

Do not fetch the reference merely because it appears in a prompt. The user's requested operation
decides whether a read is necessary.

## Implementation Steps

### Phase 1: Pure URI and picker behavior

Add:

- `apps/web/src/threadReference.ts`
- `apps/web/src/threadReference.test.ts`

Cover:

- Canonical Markdown serialization and escaping.
- URI round trips with encoded environment and thread IDs.
- Rejection of malformed, foreign-host, credential-bearing, query, fragment, and extra-segment
  URLs.
- Rejection of ports, invalid percent escapes, non-canonical redundant encoding, whitespace-only
  decoded IDs, and dot-segment spellings; acceptance and correct decoding of encoded separators in
  otherwise valid IDs.
- Current-environment and non-archived filtering.
- Current-thread exclusion.
- Search across every fixed field.
- Updated-time ordering, stable ID tie-breaking, and the 20-row cap.
- Missing-project fallback behavior and stored-label title snapshots.

### Phase 2: Composer trigger and picker

Modify:

- `apps/web/src/composer-logic.ts`
- `apps/web/src/composer-logic.test.ts`
- `apps/web/src/components/chat/ComposerCommandMenu.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`

Cover:

- Bare `%` and `%query` trigger detection at token boundaries.
- No trigger for percentages embedded in another token such as `100%`.
- Correct replacement range and trailing-space behavior.
- Empty and filtered picker states.
- Current-thread exclusion and draft-route behavior.

Do not add a full `ChatComposer` component harness solely for this feature. The existing generic
menu keyboard behavior does not change; cover thread-specific pure composition and replacement
behavior in `threadReference.test.ts` and `composer-logic.test.ts`, then use the optional integrated
client pass for the final keyboard proof.

### Phase 3: Rendered link and navigation

Add:

- `apps/web/src/components/chat/ThreadReferenceLink.tsx`
- `apps/web/src/components/chat/ThreadReferenceLink.test.tsx`
- `apps/web/src/components/ChatMarkdown.threadReference.test.tsx`

Modify:

- `apps/web/src/components/ChatMarkdown.tsx`

Cover:

- A canonical URI survives sanitization and renders as a thread chip.
- The rendered DOM `href` is the encoded same-origin thread route while `data-markdown-copy`
  retains the canonical Markdown.
- Ordinary, modified, and middle-click behavior cannot invoke the custom protocol.
- Malformed `t3code:` destinations render as plain text and never reach `openExternal`.
- Ordinary file, HTTP, fragment, mail, and telephone links retain their current behavior.

### Phase 4: Provider guidance and fork documentation

Modify:

- `apps/server/src/mcp/toolkits/threadControl/tools.ts`, keeping the provider-neutral URI guidance
  in the two affected tool descriptions rather than duplicating it across input schemas or adapters.
- `apps/server/src/mcp/toolkits/threadControl/tools.test.ts`
- `docs/README.md`
- `docs/fork/fork-journal.md`
- This specification's status and completion checklist after implementation.

Add:

- `docs/user/thread-references.md`, written as shipped-product guidance covering `%`, raw composer
  Markdown, sent chips, on-demand provider reads, the web/desktop v1 boundary, and stale title
  labels after a rename.

No Codex runtime or provider adapter test is required because their instructions and behavior do
not change.

## Verification

Run only focused checks:

```text
vp test run apps/web/src/threadReference.test.ts
vp test run apps/web/src/composer-logic.test.ts
vp test run apps/web/src/components/chat/ThreadReferenceLink.test.tsx
vp test run apps/web/src/components/ChatMarkdown.threadReference.test.tsx
vp test run apps/server/src/mcp/toolkits/threadControl/tools.test.ts
vp run --filter @t3tools/web typecheck
vp run --filter @t3tools/server typecheck
```

Adjust the exact test selector to the repository's current Vite+ syntax when implementing. Also run
targeted lint and formatting checks for changed files and `git diff --check`. Do not run the full
repository suite.

Browser verification is optional and requires explicit approval. If approved, use an isolated T3
environment and verify bare `%`, filtering, keyboard selection, raw composer Markdown, sent chip
rendering, internal navigation, the existing landing fallback for a deleted target, and an ordinary
modulo expression. Include two environments when practical to verify picker scoping and that a
rendered reference navigates with the environment encoded in the URI. Do not point a development
server at the live T3 home.

## Upstream Merge Strategy

New fork-owned files hold parsing, ranking, presentation, and most tests. Upstream-owned files get
only narrow integration seams. During an upstream merge, preserve upstream implementations first,
then reapply the behavior at the equivalent seam rather than preserving old surrounding code.

When the feature is implemented, its implementation journal entry must include the conflict and
reapplication notes below, updated to match the final diff. Do not add that journal entry while the
feature remains a plan.

### Required implementation journal notes

- `apps/web/src/composer-logic.ts` is an upstream-owned trigger hotspot. Reapply only the web-local
  `thread` trigger kind and `%` token branch after taking upstream trigger changes. If upstream
  removes the local detector or centralizes triggers, implement `%` in the new source of truth
  instead of restoring the deleted structure.
- `apps/web/src/components/chat/ChatComposer.tsx` is a high-churn upstream file. Keep upstream's
  state and menu composition, then reconnect the fork-owned thread picker at the current
  `composerMenuItems` and item-selection seams. Do not restore an old copy of the component.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` owns the upstream item union and row
  presentation. After merging upstream, re-add the `thread` item, icon, and `Threads` label to the
  current union and renderer. If upstream replaces this menu, port the item semantics rather than
  its old JSX.
- `apps/web/src/components/ChatMarkdown.tsx` is a high-churn and security-sensitive upstream file.
  Preserve upstream sanitizer, URL transformation, file-link, and external-link behavior; then
  re-add only canonical `t3code://threads/<environment>/<thread>` allow-listing and the early
  internal thread-link branch. The rendered anchor must keep using a same-origin route, and invalid
  custom-protocol destinations must degrade to plain text. Rerun tests proving malformed
  `t3code:` URLs never reach any navigation path.
- `apps/server/src/mcp/toolkits/threadControl/` is fork-owned today. Resolve any future upstream
  collision by keeping the URI explanation in provider-neutral tool metadata; do not copy it into
  Codex developer instructions or provider adapters.
- New `apps/web/src/threadReference.ts` and
  `apps/web/src/components/chat/ThreadReferenceLink.tsx` files are intended to remain fork-owned.
  Upstream should not conflict with them unless it independently ships the same feature. If that
  happens, prefer the upstream URI/parser/navigation model and delete redundant fork machinery
  after verifying `%` picker behavior and MCP recognition.
- The maintenance boundary is part of the feature: do not resolve a merge by adding message
  attachments, orchestration schemas, database fields, native mobile tokens, provider prompt
  rewriting, or external desktop protocol handling. Any such expansion needs a new explicit fork
  decision and journal entry.

## Completion Criteria

- [x] `%` opens the current-environment thread picker on web and desktop.
- [x] Results are non-archived, exclude the current thread, search the fixed metadata, and cap at 20.
- [x] Selection inserts canonical Markdown and a trailing space through the existing replacement
      path.
- [x] The composer displays raw Markdown and does not add a new inline-token type.
- [x] Sent canonical links render as internal thread chips and navigate without external URL
      handling.
- [x] The chip's DOM link uses the same-origin thread route and copied selections preserve the
      canonical Markdown.
- [x] Malformed `t3code:` links render as plain text and remain inert.
- [x] Provider-neutral MCP metadata describes URL decoding, environment validation, and how to read
      the reference.
- [x] No transcript is loaded unless the provider deliberately calls a read tool.
- [x] Mobile, contracts, persistence, provider adapters, and desktop lifecycle remain unchanged.
- [x] Mobile Markdown continues to render the unknown custom protocol without an actionable link,
      while the already-existing external mobile deep-link route remains unchanged.
- [x] User documentation and the docs index describe the shipped behavior and v1 boundaries.
- [x] Focused automated verification passes.
- [x] The implementation journal entry includes an updated conflict map matching the final diff.
