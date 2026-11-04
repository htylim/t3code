# Fork guidelines

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
Keep the fork easy to update, audit, and maintain.

## Branches and remotes

- `upstream` points to `pingdotgg/t3code`.
- `origin` points to `htylim/t3code`.
- `main` tracks `origin/main` and is our stable release channel, including fork changes.
- `fork` tracks `origin/fork` and is our continuous release and integration channel.
- `main` stays at or behind `fork`. Promote a tested `fork` snapshot to `main` when preparing
  an explicitly requested stable release. Both branches may point to the same commit.
- Create focused feature branches from `fork` for larger changes.

Check the setup with:

```bash
git remote -v
git branch -vv
```

## Update from upstream

Fetch upstream and review the commits since the last integrated upstream ancestor. Merge the
reviewed snapshot on a focused integration branch based on `fork`:

```bash
git fetch upstream
git switch fork
git switch -c integration/upstream-YYYY-MM-DD
git merge --no-commit <reviewed-upstream-commit>
```

Capture and verify maintained fork features before merging, then resolve conflicts and verify
them again on the integration branch. Adopt upstream implementations and extend only the missing
fork behavior. Do not treat files changed on both sides as competing product requirements.

Do not use `main` as an upstream mirror or move it during routine upstream integration. Do not
rewrite the shared `fork` branch. Updating shared branches, pushing, and publishing require the
developer's explicit consent.

Follow [Upstream merges](upstream-merges.md) for the review, baseline captures, integration, and
verification procedure.

## Make changes

For a focused change:

```bash
git switch fork
git switch -c feature/my-change
```

For stronger isolation, use a worktree:

```bash
git worktree add ../t3code-my-change -b feature/my-change fork
cd ../t3code-my-change
vp i
vp run dev
```

Keep each change small enough to review and merge on its own. Follow the upstream architecture and
coding rules unless this directory documents an intentional fork-specific exception.

## Worktree RPC compatibility

Worktree management RPC extensions live under `fork.worktrees.*`, with their schemas in
`packages/contracts/src/forkWorktrees.ts`. Servers advertise the supported API version under
`capabilities.fork.worktrees`; clients check it before sending fork-only requests. Increment
that API version for incompatible payload or behavior changes. Keep upstream operation names
and payloads available for their upstream behavior. Do not change the global orchestration
protocol version to advertise a fork feature. Additive capabilities can use optional flags within
that fork descriptor. `sizeSubscription` gates `fork.worktrees.subscribeMeasurements`; keep the
original `fork.worktrees.size` RPC for older clients. New clients show unavailable estimates on
servers without the flag instead of starting blocking size requests.

## Database compatibility

**NEVER introduce a fork-owned database migration.** Keeping this fork mergeable with upstream is
more important than using the app's migration runner for a convenient cleanup. Upstream owns the
entire migration sequence and the schema of its database. This rule applies to data-only changes
as well as tables, columns, and indexes. A migration that only deletes obsolete rows still claims
a migration number and changes database history.

Do not add a downstream entry to `apps/server/src/persistence/Migrations.ts`, change an upstream
migration's name or behavior, or replace an upstream migration with fork code. Do not reserve a
high number, use a negative number or a timestamp, rename an entry to make it look upstream, or
disable compatibility checks. Those approaches do not create an independent migration sequence.
The runner skips IDs through the highest recorded ID, so a fork entry can prevent later upstream
work from running. Renumbering a file also does not repair databases that already recorded it.

New upstream migrations must arrive unchanged when upstream is merged. Do not resolve a collision
by taking our version, dropping upstream's version, or marking upstream's work as completed without
executing it. Fork-only migrations make otherwise routine upstream merges depend on repairing every
affected database. They are a design error in this fork, not an acceptable integration cost.

### Store fork metadata separately

Keep fork-only metadata in fork-owned files or a separate store outside upstream's schema and
migration history. Existing JSON sidecars and device-local preferences are examples. Do not add
tables or columns to the upstream database for a downstream feature. If a feature requires an
upstream schema change, redesign its storage or get that change accepted upstream first.

Keeping feature values outside SQLite does not by itself keep a feature independent of SQLite.
Check whether it also persists jobs, event payloads, or other records in existing upstream tables.
Removing the feature must leave those records readable by the remaining code. If obsolete records
need cleanup, perform that cleanup separately. Never add a migration to retire a fork feature.

### Execute data repairs separately

Use an explicitly invoked maintenance command or a one-time operator script for a necessary data
repair. Do not hide it in startup, the migration loader, or an automatic compatibility workaround.
The repair must name the target database, explain the exact records it changes, and require explicit
authorization before writing live state. A development server must never use the live database.

Before a live repair, test it on a disposable copy and create a consistent SQLite backup. Do not
copy only the main file while a writer has uncheckpointed WAL data. Check the expected history and
affected rows inside the same transaction as the write. Use narrow predicates, verify the number
of affected rows, and roll back on an unexpected state. Make a repeat invocation harmless or fail
without changes. Verify the result and keep the backup until the repaired app has been checked.

Stop the owning app when a repair changes schema or data that running services cache. A narrowly
scoped migration-history correction can use a short SQLite write transaction without stopping
agents, provided it does not change application data and the history is rechecked under the lock.
Do not stop the T3 server hosting the current session without arranging how work will continue.

### Why fork migration 63 was removed

The retired tag feature stored tag values in `fork/thread-tags.json`, but its inheritance tasks
lived in the existing `orchestration_v2_effect_outbox` table. Removing tags introduced
`63_RemoveThreadTagEffects` to delete tasks whose type was `thread-tag.inherit`. It added no tables
or columns, but it still recorded migration 63 as `RemoveThreadTagEffects`.

Upstream then assigned 63 to `DropUnusedV1Projections`. The different recorded name makes the
startup compatibility check fail. Without that check, the migration runner would skip upstream's
cleanup. This collision was caused by putting fork maintenance in upstream's migration sequence.

The correction removes our migration source and registration. For a database whose latest entry
is exactly `63 / RemoveThreadTagEffects`, first verify that no obsolete tag tasks remain. A
separate, authorized repair can then delete only this registration:

```sql
DELETE FROM effect_sql_migrations
WHERE migration_id = 63 AND name = 'RemoveThreadTagEffects';
```

This statement is not a general migration rollback. Do not run it if later migrations exist, if
63 has a different name, or without verifying the original cleanup completed. Removing the history
row does not restore deleted tasks, and it must not pretend upstream's migration already ran.
After repair, the history ends at 62 and upstream's real migration 63 remains free to execute.

An older installed Fork build still contains the removed registration and will recreate it on
startup. Use a build containing this correction for subsequent launches. Do not silently modify
the installed app as part of a source change. Independently review and repair any other affected
database; never recursively rewrite every database found on the machine.

## Develop and verify

The repository requires Node 24 and Vite+ (`vp`):

```bash
curl -fsSL https://vite.plus | bash
vp i
vp run dev
```

`vp run dev` starts the server and web client and prints a one-time pairing URL. Use
`vp run dev:desktop` for desktop development.

All live tests must use the ChatGPT provider instance named `Personal`, authenticated with the
personal ChatGPT subscription. Its configured Codex home is `~/.codex-personal` and its shadow
home is `~/.codex-t3/personal`. Never use another provider instance or account for testing,
including the ShipHero ChatGPT or Claude accounts. If Personal is unavailable, stop live
provider testing and report the blocker. Do not fall back to another provider.

Never use expensive models for live provider tests. Use cheap models such as Luna or Sonnet.
With the required Personal provider, select Luna with low reasoning effort. Keep test prompts
and responses short, including background title-generation prompts.

Explicitly select and verify the Personal provider instance and test model before sending a turn;
do not rely on app defaults or inherit a provider or expensive model from an existing conversation.
This applies to every test surface and to side chats,
native forks, and MCP child threads as well as main threads.

## Build the Fork desktop app

Desktop packaging requires Rust and Cargo because it compiles the native resource monitor bundled
with the app. Install Rust with [rustup](https://rustup.rs/), then make Cargo available in the current
shell:

```bash
source "$HOME/.cargo/env"
cargo --version
```

Use a SemVer prerelease ending in `-fork` or `-fork.<identifier>` to select the downstream desktop
identity. The artifact builder aligns the server, client, and Electron versions before compiling:

```bash
fork_version=0.0.31-fork.1
vp run dist:desktop:dmg --build-version "$fork_version"
```

The builder temporarily updates the releasable package manifests and sets `APP_VERSION`, then
restores the original manifests. A checkout lock prevents overlapping builds from racing these
writes. Do not manually stamp source manifests for a normal artifact build. With `--skip-build`,
the existing compiled server and client must already contain the exact artifact version.
Use the disposable release worktree below so generated outputs stay separate from development.

The artifact is written to `release/` and installs as `T3 Code (Fork)` with the bundle identifier
`com.htylim.t3code.fork`. Fork builds deliberately keep using `~/.t3/userdata`, so they see the same
projects, threads, and settings as the upstream packaged app. The shared user-data lock means Fork
and upstream desktop apps must not run at the same time.

macOS Fork artifacts check the fork-owned `fork-desktop-update.json` asset on the Latest GitHub
Release in `htylim/t3code`. The sidebar and Settings offer the matching DMG directly in the
browser. Quit Fork and replace the app manually. Fork never uses the upstream update feed or
Electron's automatic installer. Increment the numeric fork suffix for each release.
Existing builds without this checker need one manual installation to receive update notifications.

Fork artifact builds include T3 Connect by using the public identifiers in `.env.example` as
lowest-precedence defaults. Process environment variables, `.env.local`, and `.env` still override
them. This keeps T3 Connect enabled in the disposable release worktree without storing secrets or
copying an ignored file into it. Direct source development remains opt-in; copy `.env.example` to
`.env` when `vp run dev:desktop` should expose the cloud UI.

Before the first install, back up `~/.t3/userdata` and fully quit every running T3 Code app. Open the
DMG and drag `T3 Code (Fork)` into `/Applications`. Local builds have an ad-hoc bundle signature,
but no Apple Developer ID or notarization. Follow the [Gatekeeper approval steps](#gatekeeper-approval-for-local-builds)
if macOS blocks the app.

T3 Code Nightly and T3 Code Fork can remain installed together. They cannot run together: both use
the same production database, settings, logs, and Electron user-data lock. Quit one before starting
the other. Giving the apps separate bundle identifiers does not isolate their shared runtime state.

Run the smallest relevant tests, lint checks, and type checks for each change. Do not point a
development server at `~/.t3/userdata`, and do not set `VITE_HTTP_URL` or `VITE_WS_URL`.

### Gatekeeper approval for local builds

Include these steps in every macOS fork release's installation notes while Developer ID signing
and notarization remain unconfigured:

1. Open the installed `T3 Code (Fork)` from Finder's Applications folder. If macOS says Apple
   could not verify the app, click **Done**.
2. Open **System Settings > Privacy & Security** and scroll down to **Security**.
3. Click **Open Anyway** for `T3 Code (Fork)`. On versions showing **Open** first, click that,
   then **Open Anyway**. Authenticate and confirm opening the app.
4. If no approval button appears, try opening the installed app again, dismiss the warning,
   and close and reopen Privacy & Security. Apple says the button is available for about an hour
   after the attempted launch. If it is still missing, ask for the macOS version and a screenshot
   of the Security section before suggesting another workaround.

These are [Apple's per-app approval steps](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).
Do not disable Gatekeeper globally or automatically strip quarantine from the installed app.
A damaged-app warning requires signature verification and investigation; do not treat it as an
ordinary unverified-developer warning. Ad-hoc signing verifies bundle integrity but does not
establish Apple trust. Removing the unverified-developer approval step requires Developer ID
signing and notarization. Do not promise a warning-free installation with the current build mode.

## Release the Fork desktop app

Follow [Making Fork releases](making-fork-releases.md) for stable releases. It covers
committing and merging into `fork`, promoting to `main`, building, verifying, tagging,
and publishing the GitHub release and update feed. Keep that runbook as the single
release procedure.

### Rehearse updates locally

For a packaged test copy, set `T3CODE_DESKTOP_MOCK_UPDATES=true`, an absolute
`T3CODE_HOME` outside the daily-use `~/.t3` directory, and
`T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT`. This combination isolates Electron's profile below
`<test-home>/mock-electron` as well as server data below `<test-home>/userdata`.
The mock feed is loopback-only. Without an isolated home the Fork checker keeps its public feed;
a managed policy always takes precedence.

Use `vp run start:mock-update-server` with `T3CODE_DESKTOP_MOCK_UPDATE_SERVER_ROOT` set to an
absolute fixture directory and the same port. Put the manifest at
`latest/download/fork-desktop-update.json` and each DMG at
`download/fork-v<version>/T3-Code-<version>-arm64.dmg` below that directory.
The server refuses symlinks escaping its root. Copy or hard-link artifacts into it.
The isolated profile still uses the system Keychain. An ad-hoc build can prompt for access to
`t3code Safe Storage`; a pending prompt can prevent startup from completing.
Launch the copied app's executable directly with the test environment; opening it normally from
Finder does not retain these environment variables. Keep all test installations outside
`/Applications`. Use the same isolated home when replacing A with B.

## Record downstream drift

Update `fork-journal.md` when a change creates or changes a maintained difference from upstream.
Record the reason, scope, upstream baseline, and verification. When a fork feature is removed or
replaced by upstream, delete its documentation and merge instructions instead of adding a retirement
entry. Git preserves the history.

## License and distribution

T3 Code uses the MIT License. Keep its license and copyright notice in copies or distributions.
Treat branding, package names, application identifiers, hosted services, and release signing as
explicit product decisions before distributing the fork.
