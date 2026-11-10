# Upstream merges

Use this runbook when asked to integrate upstream into the fork. Complete the review,
implementation, verification, and local installable build without asking the maintainer to decide
each commit or resolve routine implementation choices. The final decision is the maintainer's
acceptance of the tested build before updating `fork`.

Read the root instructions, [fork guidelines](fork-guidelines.md), and current
[fork journal](fork-journal.md) first. This runbook defines the procedure. The journal records why
maintained fork behavior exists. Source and tests establish what still exists today.

## 1. Pin the source and destination

Inspect the checkout, remotes, existing edits, and worktrees. Preserve unrelated work.

```bash
git status --short
git remote -v
git worktree list --porcelain
git fetch --all --prune
git rev-parse HEAD fork main origin/fork origin/main upstream/main
git log --first-parent --merges -8 --format='%H %P %s'
```

Record the original fork head, stable head, upstream baseline, and incoming target as full SHAs
outside the repository. Confirm that `upstream` is pingdotgg/t3code and `origin` is our fork.

Use the upstream parent of the previous integration to identify the last integrated upstream
snapshot. Check it against `git merge-base fork upstream/main` and commit ancestry. A journal date,
release version, local `main`, or merge subject alone does not establish the baseline.

Work on an integration branch based on the requested fork snapshot. Reuse the task's existing
integration branch when appropriate. If another checkout is needed, create a worktree beside the
current one using absolute paths. Do not switch a shared checkout out from under another session.

Merge the pinned upstream SHA throughout this task. Another fetch must not silently enlarge the
reviewed batch. Leave `main`, `fork`, and their remote branches unchanged during preparation.

`fork` is the continuous channel. `main` is stable and stays at or behind `fork`. Equality is fine.
Neither branch is an upstream-only mirror.

## 2. Establish the maintained fork behavior

Compare both sides from the upstream baseline:

```bash
git log --reverse --oneline <upstream-baseline>..<upstream-target>
git diff --stat <upstream-baseline> <upstream-target>
git diff --stat <upstream-baseline> <fork-head>
git diff --name-only <upstream-baseline> <upstream-target>
git diff --name-only <upstream-baseline> <fork-head>
```

Read every incoming subject. Inspect the implementation and tests for changes that touch fork
behavior, its dependencies, shared contracts, persistence, or packaging. File overlap helps find
integration work; it does not establish that upstream replaces a fork feature.

Build a verification matrix outside the repository. Give each maintained feature its intended
outcome, current implementation, affected entry points, baseline result, focused tests, before/after
captures, live result, and remaining limits. Include non-UI behavior such as background command
stopping, cleanup, storage, desktop identity, Connect configuration, and signature verification.

Reconcile the journal against the actual fork diff. Historical verification entries are not
instructions to restore obsolete code. When a maintained feature lacks its reason, add that reason
to its existing journal entry. Infer it from recorded decisions, tests, and behavior. Ask only when
a material product decision remains ambiguous after that investigation.

## 3. Decide replacements by intent

Apply these rules without asking the maintainer to classify every incoming change.

| Upstream behavior                          | Required action                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Does not replace our intended outcome      | Bring upstream's changes and preserve the fork behavior. Adapt to changed APIs or components where needed. |
| Fully supplies our intended outcome        | Adopt upstream and remove the entire fork implementation.                                                  |
| Supplies only part of our intended outcome | Adopt upstream first, then implement the missing behavior as a small extension of its new implementation.  |

For a partial replacement, design the extension as if implementing it today on the incoming
upstream snapshot. Do not preserve the old implementation verbatim or replace upstream's approach
with it. Upstream directs product architecture.

For a full replacement, remove obsolete entry points, contracts, services, settings, helpers,
tests, dependencies, and documentation. Check for remaining references and unused code. Existing
stored data must remain readable; authorized cleanup is a separate operation, never a migration.

Use these established intents when assessing overlaps:

- Adopt upstream's parent-composer permission and reasoning inheritance for side chats. Keep
  selection comments and newest-side-chat quote reuse as narrow extensions. Preserve upstream's
  organization ceilings and policy failures.
- Usage exclusions omit a provider account from Cost and Tokens. Provider/model filters do not
  replace this. Compose account selection with upstream aggregation and cache invalidation.
- Worktree controls identify the physical checkout, group its threads, and allow manual management,
  including directory rename and removal. Git performance or cleanup fixes do not replace them.
- Native thread tags do not replace worktree names or colors. Do not revive retired fork tags.
- Shared sidebar, citation, browser, and desktop files can change without replacing fork behavior.
  Retain upstream accessibility, rendering optimizations, authorization, and failure handling.

Prefer existing services and components with narrow extensions. When extending one would require
a large upstream rewrite, keep separate fork components and logic instead. Do not rearchitect
upstream to preserve the fork.

Never add a fork-owned database migration, claim a migration number, alter upstream migration
history, or hide a repair in startup. Store fork metadata outside upstream's database schema.
Follow [Database compatibility](fork-guidelines.md#database-compatibility).

## 4. Verify and capture the baseline before changing code

Use the `test-t3-app` skill for the integrated web/desktop UI. Use `test-t3-mobile` for native
mobile when applicable. Retain the isolated dev server's terminal session and actual ports.
Follow [Launch and capture isolated UI evidence](../operations/ui-evidence.md) for readiness,
pairing, screenshot quality checks, and the verified headless screenshot/video fallback.
Use this worktree's ignored `.t3` state. Never point a dev server at live userdata or set
`VITE_HTTP_URL` or `VITE_WS_URL`.

Seed meaningful stopped-thread data using the existing helper and SQLite fixture guidance.
Copied thread paths can still point to real checkouts. Use a disposable Git project for all
workspace rename, deletion, checkout changes, and provider turns. Disable automatic worktree
cleanup in the isolated settings. Back up the isolated database consistently and retain relevant
device preferences before the merge.

Exercise every matrix feature at baseline. Capture each visible feature, including its dialogs,
menus, grouped and single rows, notices, selection drafts, light/dark appearance, and relevant
narrow layouts. Record actual CSS viewport dimensions, screenshot dimensions, and settings.
Save images and logs outside the repository with stable feature names. Inspect every image.
Blank, stale, clipped, or unreadably blurry images are evidence gaps, not successful captures.

Run the focused fork regressions at baseline. Record existing failures so the integrated run can
distinguish them from regressions. Fix a small existing defect when it fits the integration.
Report a larger detour instead of expanding the task.

Use Replay for provider-independent streaming checks. When real provider behavior is required,
use only Personal with Luna at low reasoning effort. Verify the selected account, model, and
background title/text-generation defaults before sending. Do not inherit an expensive model
from copied threads or use another account.

## 5. Merge and adapt

Stop only the isolated dev server you started, using its retained terminal session, before
dependency or persistence changes.

```bash
git merge --no-commit <upstream-target>
git diff --name-only --diff-filter=U
```

Inspect each conflict and surrounding code from both parents. Resolve behavior rather than taking
whole files from ours or theirs. Review automatically merged files too, especially imports, props,
test setup, policy handling, and dependency upgrades.

Install the merged dependency versions. Changes such as Effect upgrades can require explicit
service layers in fork-only tests even when there was no textual conflict. Preserve upstream's
regression assertions and add focused tests for the behavior changed by the integration.

Upstream migrations must match the pinned target byte-for-byte. Inspect the migration registry and
its migrations directory explicitly. Never repair a live database during an upstream merge.

Record the local integration commit once conflicts and required adaptations are resolved. A local
commit is a reviewable checkpoint, not permission to update a release branch.

## 6. Verify the integrated behavior

Restart the isolated dev server and repeat every matrix workflow. Test entry points and outcomes,
including keyboard actions, cancellation, Undo/restoration, persistence after reload, shared
workspace updates, permission ceilings, busy guards, and actual service behavior.

Compare after images with their corresponding before images under the same settings and viewport.
Upstream may change the design. Fork controls must remain coherent with it and must still satisfy
their intended outcome. Screenshots prove appearance; automated tests and live actions prove
behavior. One does not replace the other.

Cover applicable clients, providers, MCP/service paths, and connection modes from the root
instructions. Browser checks of shared desktop UI do not establish that the installed Electron
app launches. Packaging tests do not establish a native mobile or remote/tunnel pass.

Run existing focused fork regression files, affected package typechecks, and web/server builds.
After the local merge commit, check maintained fork differences against the pinned upstream ancestor:

```bash
vp run check:changed <upstream-target>
```

Before that merge commit, merge-base selection can include the entire incoming upstream batch.
Do not substitute an explicitly repo-wide command for the repository's changed-file workflow.

For every failed or skipped test, record its name, reason, impact, and evidence. Reproduce uncertain
failures against the baseline or unchanged upstream implementation without disturbing shared
branches. Restore the integrated source afterward. Do not make a failure disappear with retries,
sleeps, weaker assertions, or wider timeouts. Missing prerequisites are setup work to resolve when
practical. A skip is not a pass.

A screenshot timeout or blurred foreground text is not a visual pass. Distinguish missing tabs,
backend readiness, auth failures, and capture faults using the UI evidence procedure. Reopening
the panel recovered earlier timeouts, but the November 6 audit still reproduced blurred PNGs
and video through desktop-backed capture. T3's headless renderer produced readable evidence.
Follow current browser instructions for any fallback. If approval review rejects one, report
the reason and obtain explicit permission before retrying it.

## 7. Prepare the evidence and update documentation

Update maintained feature intent and operating guidance in place. Remove documentation for deleted
fork implementations. Add a concise journal entry with the upstream baseline/target, fork source,
adaptations, tests, live checks, and limits. Keep temporary matrices, logs, screenshots, and build
notes outside the repository.

Provide a browsable before/after comparison and exact test output. Label repeated screenshots,
after-only states, invalid captures, tests covered only by automation, and workflows not exercised.
Do not say "fully verified" when tests fail, prerequisites caused skips, or required live paths
remain untested. Explain the practical limits so the maintainer can make an informed decision.

Fix integration regressions before building the candidate. Keep unrelated baseline/upstream
failures explicit. Ask the maintainer to accept those limits at sign-off rather than quietly
treating them as successful checks.

## 8. Build the local installable candidate

Build from the committed integration snapshot before updating `fork`. Follow the
[desktop packaging procedure](fork-guidelines.md#release-the-fork-desktop-app) for version selection,
focused packaging checks, detached build isolation, exact version stamping, and artifact verification.

For a local review build, stop before tagging, pushing, or publishing. No release or GitHub upload
is needed. Use the next unused numeric `0.1.0-fork.N` version after checking local tags, remote tags,
published releases, and existing candidate artifacts. Record the full source commit and architecture.
Build in a disposable detached worktree beside the current worktree, using absolute paths.
Do not change source manifests by hand or build over a running development checkout.

Verify the DMG and ZIP, both contained app signatures, bundle identifier, embedded commit, exact
app/server/client versions, architecture, minimum macOS version, and absence of the upstream update
feed. Smoke-test the packaged server and client using fresh temporary state. Do not launch against
the daily-use database or Electron profile.

Keep the DMG, checksum, and a short verification record accessible after removing the build
worktree. Give the maintainer installation instructions and known failures. Explain that Fork shares
userdata with the daily-use T3 app, requires a backup and quitting the other app before launch,
and uses ad-hoc signing without Developer ID or notarization. Link the documented per-app
[Gatekeeper approval steps](fork-guidelines.md#gatekeeper-approval-for-local-builds).

## 9. Wait for DMG sign-off

Stop here for the maintainer to install and test the candidate. Building the DMG is not permission
to update `fork`. Do not install it, replace the running app, move release branches, or publish
anything on the maintainer's behalf.

Record which commit/version the maintainer tested and any accepted limits. If a correction changes
shipped code, rebuild, rerun affected checks, and obtain sign-off on the replacement candidate.
A response that explicitly approves the build and asks to merge is sufficient; do not ask again.

## 10. Update fork only after authorization

Once the maintainer signs off and authorizes the merge, recheck the integration head and the current
`fork` head. Confirm that the candidate still represents the code being promoted.

If `fork` is still an ancestor of the approved integration, fast-forward it in the checkout that
owns that branch. This preserves the upstream merge commit and reviewed history:

```bash
git merge-base --is-ancestor <current-fork-head> <approved-integration-head>
git -C <absolute-fork-checkout> status --short
git -C <absolute-fork-checkout> merge --ff-only <approved-integration-head>
```

Respect existing edits and active processes in that checkout. Do not force an update or reset a
shared branch. If `fork` advanced independently, integrate its new work into the review branch,
repeat affected verification, and rebuild for sign-off when shipped code changed.

Leave `main` unchanged. Promoting stable, pushing a branch, opening a PR, and publishing a release
each need the authorization appropriate to that action. A local merge request alone does not
authorize them. Before an authorized push, complete the repository's required changed-file check
and disclose any accepted failures.

Report the final integration and fork SHAs, artifact version and source commit, sign-off, accepted
limits, and whether anything was pushed. Verify that `main` did not move. Keep the dev server and
panel available for inspection; ending the assistant turn is not teardown.
