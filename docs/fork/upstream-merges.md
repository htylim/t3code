# Upstream merges

Merge upstream while keeping the fork's intended behavior and making the next merge no harder.
Use this procedure with the current [fork journal](fork-journal.md) and
[fork guidelines](fork-guidelines.md). The journal explains why maintained differences exist.

## Establish the exact scope

Inspect the working tree and remotes before changing anything. Preserve existing edits. Use an
isolated review branch based on the requested fork snapshot. Do not move `main` or `fork` merely
to prepare an integration. `fork` is the continuous channel; `main` is the stable channel and
stays at or behind it.

```bash
git status --short
git remote -v
git fetch --all --prune
git rev-parse HEAD upstream/main
git merge-base HEAD upstream/main
git log --first-parent --merges -6 --oneline
```

Confirm the merge base against the actual upstream parent of the previous integration. Journal
dates, release tags, and local `main` are not reliable substitutes. Record the full fork head,
upstream baseline, and upstream target SHA outside the worktree. Use that target SHA for the
rest of the integration so another fetch cannot expand the reviewed scope.

## Compare feature intent

Read every incoming commit subject, then inspect the implementation and tests of changes relevant
to fork behavior. Compare both baseline-to-upstream and baseline-to-fork diffs. Reconcile the
journal with current source; historical verification entries are not a list of features to restore.
Add a missing reason to the maintained feature's journal entry before deciding what replaces it.

Classify behavior, not filenames:

- No replacement. Keep the fork feature and bring upstream's changes. Shared files and changed
  APIs identify integration work, not competing requirements.
- Full replacement. Adopt upstream and remove the fork implementation, its entry points,
  contracts, settings, tests, dependencies, and obsolete documentation. Check for unused pieces.
- Partial replacement. Adopt upstream's implementation and extend it with the missing fork
  behavior as if implementing that extension today. Do not paste the old implementation over it.

Ask what upstream actually lets the user do. Provider/model usage filtering does not replace
excluding one provider account. Thread tags do not replace identifying and managing physical
worktrees. An organization permission ceiling does not require forcing every side chat into
Supervised mode. Keep parent-mode inheritance within the upstream policy checks.

Upstream directs the architecture. Prefer existing components and services, narrow extensions,
and separate fork modules when an extension would otherwise require a large rewrite. Fork
metadata stays outside upstream's database schema. Never add a fork migration, renumber an
upstream migration, or hide a data repair in startup.

## Capture and verify the baseline

Use the `test-t3-app` skill and this worktree's ignored `.t3` state. Retain the dev server's terminal
session and read its actual ports. Never point it at live state or set `VITE_HTTP_URL` or
`VITE_WS_URL`. A missing dependency install or denied localhost bind is a setup problem to fix
before testing.

Use copied stopped-thread data for meaningful history. Follow the existing seeding helper and
SQLite fixture guidance. Use a disposable Git project for rename, deletion, checkout changes,
and agent turns. Copied thread paths can still refer to real checkouts, so do not mutate those
workspaces. Disable automatic worktree cleanup in the isolated settings.

Derive a verification matrix from the maintained feature entries and actual fork diff. For each
feature, record its intent, UI entry points, baseline behavior, screenshots, and focused tests.
Some features, such as packaging checks, have no running web UI; record the appropriate artifact
or test evidence instead.

Capture each visible feature before merging. Include relevant grouped and single rows, menus,
dialogs, notices, keyboard entry points, light/dark appearance, and narrow layouts. Save captures
outside the worktree with stable feature names and record the viewport and settings. Inspect the
images: a saved path does not prove a capture contains the intended state.

Verify behavior as well as appearance. Separate a pre-existing failure from a regression. Fix a
small pre-existing defect if it fits the integration; report a larger one without turning the
merge into another project. Run live provider tests only on Personal with Luna at low effort,
explicitly verifying the account, model, and background text-generation defaults before sending.

Before changing source, retain a consistent backup of the isolated database and relevant device
preferences. Exclude pairing credentials from screenshots, commits, and reports.

## Integrate the reviewed snapshot

Stop the dev server using its retained terminal session before dependency and persistence changes.
Merge the pinned SHA on the review branch:

```bash
git merge --no-commit <reviewed-upstream-commit>
git diff --name-only --diff-filter=U
```

Inspect each conflict and the surrounding code on both sides. Do not resolve whole files by
choosing ours or theirs. Delete a replaced component rather than retaining an unused compatibility
copy. Keep upstream's rendering optimizations, policy failures, authorization, and Git cleanup when
adding fork behavior. Check automatically merged files too.

Install the merged dependency versions. Library upgrades can require changes to fork-only imports,
test helpers, and service layers even when Git reports no conflict. Incoming tests may also need
required fork props or contracts. Preserve meaningful upstream regression assertions.

Keep upstream migrations byte-for-byte unchanged. Do not repair live databases as part of this
procedure. Any necessary live maintenance is a separate, explicitly authorized operation.

## Verify the integrated fork

Restart the isolated dev server and exercise every feature in the matrix. Compare after captures
with the corresponding before captures under the same viewport and settings. Upstream can change
the design, but fork controls must still look consistent and support the intended workflows.

Test the complete behavior, including cancellation, restoration, persistence after reload, and
permission or busy-state guards. Check applicable web, desktop, mobile, provider, and remote paths
from the root instructions. Distinguish browser verification of shared desktop UI from testing
the Electron shell or a native mobile client.

Extend existing focused tests at the lowest layer that demonstrates a regression. Run the fork's
existing regression files, affected package typechecks, and web/server builds. Do not replace
these with an explicitly repo-wide test command. After recording the local merge, run:

```bash
vp run check:changed <reviewed-upstream-commit>
```

Using the upstream ancestor here checks the maintained fork differences. Before the merge commit,
the tool's merge-base comparison also includes the entire incoming upstream batch. Still run the
normal changed-file check required by the repository before an authorized push.

A screenshot timeout is not a visual pass. Try recovery within the built-in Browser panel, retain
valid captures, and report the exact missing comparisons. If clicks work while captures time out,
ask the maintainer to close and reopen the panel, then reacquire the tab and restore its viewport.
Opening another tab in the same panel did not recover capture in the November 3 integration;
reopening the panel did. Inspect replacement captures before counting them as evidence.
Follow the current browser instructions
before using another browser. If approval review rejects a fallback, report its reason and obtain
explicit consent before trying again. Limit any approved fallback to the isolated dev application.
A source merge may be committed for review while verification is blocked, but the integration is
not fully verified until the remaining checks pass or the maintainer explicitly accepts the
limitation.

## Record and hand back

Update maintained intent and changed operating guidance in place. Remove documentation belonging
to deleted fork implementations. Add a concise integration journal entry with the exact upstream
baseline, adaptations, evidence, pre-existing failures, and unverified paths. Keep temporary logs,
screenshots, checklists, and research notes outside the repository.

Report the review branch and commit, retained or replaced behavior, test results, and any outstanding
verification. Verify that shared branch heads did not move. Updating `fork`, promoting `fork` to
`main`, pushing, opening a PR, installing an app, and publishing are separate actions requiring
explicit consent. Follow the release runbook only when a release is requested.
