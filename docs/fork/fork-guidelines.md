# Fork guidelines

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
Keep the fork easy to update, audit, and maintain.

## Branches and remotes

- `upstream` points to `pingdotgg/t3code`.
- `origin` points to `htylim/t3code`.
- `main` tracks `upstream/main` and must not contain custom commits.
- `fork` tracks `origin/fork` and is the integration branch for our changes.
- Create focused feature branches from `fork` for larger changes.

Check the setup with:

```bash
git remote -v
git branch -vv
```

## Update from upstream

Fast-forward `main`, push the same state to the fork, then merge it into `fork`:

```bash
git switch main
git fetch upstream
git merge --ff-only upstream/main
git push origin main

git switch fork
git merge main
git push origin fork
```

Do not resolve upstream conflicts on `main`. Resolve them on `fork` or a feature branch so `main`
remains an exact upstream mirror. Do not rewrite the shared `fork` branch.

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
identity. Before compiling a release, set the releasable package manifests to that exact version in
a disposable worktree as described below:

```bash
fork_version=0.0.31-fork.1
node scripts/update-release-package-versions.ts "$fork_version"
APP_VERSION="$fork_version" vp run dist:desktop:dmg --build-version "$fork_version"
```

All three version inputs are required. The package manifests are compiled into the server,
`APP_VERSION` is compiled into the web client, and `--build-version` controls Electron and artifact
metadata. Setting only the latter two produces an internally inconsistent app whose client reports
the fork version while its server reports the base package version. Do not modify a source branch
just to align these build inputs; use the disposable release worktree below.

The artifact is written to `release/` and installs as `T3 Code (Fork)` with the bundle identifier
`com.htylim.t3code.fork`. Fork builds deliberately keep using `~/.t3/userdata`, so they see the same
projects, threads, and settings as the upstream packaged app. The shared user-data lock means Fork
and upstream desktop apps must not run at the same time.

Fork artifacts do not include an upstream auto-update feed. Build and install a new artifact to
update the fork, incrementing the final fork version identifier for each release.

Fork artifact builds include T3 Connect by using the public identifiers in `.env.example` as
lowest-precedence defaults. Process environment variables, `.env.local`, and `.env` still override
them. This keeps T3 Connect enabled in the disposable release worktree without storing secrets or
copying an ignored file into it. Direct source development remains opt-in; copy `.env.example` to
`.env` when `vp run dev:desktop` should expose the cloud UI.

Before the first install, back up `~/.t3/userdata` and fully quit every running T3 Code app. Open the
DMG and drag `T3 Code (Fork)` into `/Applications`. Local builds have an ad-hoc bundle signature,
but no Apple Developer ID or notarization. If macOS blocks an unverified developer, follow
[Apple's per-app approval instructions](https://support.apple.com/en-us/102445) in System Settings
under Privacy & Security. A damaged-app warning requires investigation and signature verification;
do not treat it as proof that manual approval is all that is missing.

T3 Code Nightly and T3 Code Fork can remain installed together. They cannot run together: both use
the same production database, settings, logs, and Electron user-data lock. Quit one before starting
the other. Giving the apps separate bundle identifiers does not isolate their shared runtime state.

Run the smallest relevant tests, lint checks, and type checks for each change. Do not point a
development server at `~/.t3/userdata`, and do not set `VITE_HTTP_URL` or `VITE_WS_URL`.

## Release the Fork desktop app

Fork releases are manual desktop builds with ad-hoc macOS bundle signatures. They are not
Developer ID signed or notarized. Do not use `.github/workflows/release.yml`: its
stable path publishes the upstream `t3` npm package, deploys upstream hosted channels, and pushes a
version commit to `main`.

### 1. Choose and record the release source

Release from the branch the developer explicitly names. Use `fork` only when no other source branch
was requested, and never merge, fast-forward, reset, or otherwise move `fork` to prepare a release
from another branch. Never release from `main`. Review the selected worktree and commit everything
intended to ship. An unrelated untracked file can remain, but do not release tracked changes that
are not committed.

```bash
release_source_branch="$(git branch --show-current)"
git status --short
release_commit="$(git rev-parse HEAD)"
fork_commit_before="$(git rev-parse fork)"
git tag --list 'fork-v*' --sort=-version:refname | head
git ls-remote --tags origin 'fork-v*'
```

If the developer named a branch, confirm `release_source_branch` is that exact branch before doing
anything else. Keep `fork_commit_before` and verify at the end that `fork` still points to it.

The fork suffix is not stored or incremented by the project. Check the previous release and choose
the next value manually, for example `0.0.31-fork.2` to `0.0.31-fork.3`. Capture the release commit
before building so it can be compared with the commit embedded in the artifact.

### 2. Run the focused packaging checks

```bash
source "$HOME/.cargo/env"
cargo --version
vp --version
vp test run scripts/build-desktop-artifact.test.ts packages/shared/src/desktopBuildIdentity.test.ts
```

Run any additional focused tests required by the changes included in the release. Do not replace
these with repo-wide checks unless specifically requested.

### 3. Build an explicit architecture and exact version

Compile in a disposable detached worktree so release-only package versions never dirty or move the
source branch. The detached worktree still embeds `release_commit`, while the temporary manifest
updates make the server, client, Electron metadata, and artifact names agree:

```bash
fork_version=0.0.31-fork.3
release_root="$PWD"
release_stage="$(mktemp -d "${TMPDIR%/}/t3code-fork-release.XXXXXX")"
git worktree add --detach "$release_stage" "$release_commit"

cd "$release_stage"
vp i --frozen-lockfile
node scripts/update-release-package-versions.ts "$fork_version"
APP_VERSION="$fork_version" vp run dist:desktop:dmg:arm64 --build-version "$fork_version"

test "$(node apps/server/dist/bin.mjs --version)" = "t3 v${fork_version}"
rg --fixed-strings -l "$fork_version" apps/server/dist/client/assets

mkdir -p "$release_root/release"
cp "release/T3-Code-${fork_version}-arm64.dmg" "$release_root/release/"
cp "release/T3-Code-${fork_version}-arm64.zip" "$release_root/release/"

cd "$release_root"
git -C "$release_stage" restore -- \
  apps/server/package.json \
  apps/desktop/package.json \
  apps/web/package.json \
  packages/contracts/package.json
git worktree remove "$release_stage"
```

Both version checks are mandatory. The first exercises the compiled server's actual `--version`
output; the second confirms the built client contains the exact same version. A matching DMG name
or `Info.plist` alone is not proof that the bundled server and client agree.
`git status --short` in the release worktree must show only the four package manifests updated by
`update-release-package-versions.ts`; the frozen install must not rewrite `pnpm-lock.yaml`.

Start without `--verbose`; its electron-builder output is large enough to hide the useful final
error. Use it only when diagnosing a focused failure. The packaging stage installs locked
production dependencies into a temporary directory, so it needs npm registry access even when the
workspace dependencies are already installed. If a sandboxed run reports `ENOTFOUND`, stop the
retry loop and rerun the same command with approved network access.

A yielded or truncated command is not success. Wait for the process exit code and the final
`[desktop-artifact] Done. Artifacts:` message. Confirm the output files have new timestamps; an old
file with the requested version in its name may be a stale artifact from an earlier attempt.

The packaging script generates the macOS `.icns` from `assets/prod/black-macos-1024.png` and stages
the current DMG background. It no longer reads checked-in icon files from
`apps/desktop/resources`. Do not restore those deleted files or replace `iconutil` with a shim. If
icon staging fails, fix the host toolchain and rerun the packaging command. A build that did not
complete asset staging is not releasable.

### 4. Verify the artifacts before tagging

For an Apple Silicon release, verify at least the DMG, ZIP, exact version, bundle identifier,
embedded commit, and native resource monitor:

```bash
dmg="release/T3-Code-${fork_version}-arm64.dmg"
zip="release/T3-Code-${fork_version}-arm64.zip"
release_commit_short="$(git rev-parse --short=12 HEAD)"

stat -f '%N | %Sm | %z bytes' "$dmg" "$zip"
shasum -a 256 "$dmg" "$zip"
hdiutil verify "$dmg"
unzip -p "$zip" 'T3 Code (Fork).app/Contents/Info.plist' | plutil -p -
unzip -p "$zip" 'T3 Code (Fork).app/Contents/Resources/app.asar' \
  | strings | rg -m 1 "$release_commit_short"
unzip -Z1 "$zip" \
  | rg 'Contents/(MacOS/T3 Code \(Fork\)|Resources/resource-monitor/t3-resource-monitor)$'
```

The main `Info.plist` must report the exact fork version and bundle identifier
`com.htylim.t3code.fork`. The embedded commit must equal the release commit captured before the
build. Recheck `git rev-parse fork` against `fork_commit_before`; a release from another branch must
not move `fork`. Verify the full bundle signature in both delivery formats before publishing:
extract the ZIP into a disposable directory with `ditto -x -k`, mount the DMG read-only, and run
`codesign --verify --deep --strict --verbose=2` on each contained `.app`. Both checks must succeed.
The packaging script also verifies the staged app before exporting artifacts. An ad-hoc signature
checks bundle integrity, but does not provide Apple Developer ID trust or notarization. Do not
claim a standard Gatekeeper-approved installation without configuring and testing both.

### 5. Tag safely, then stop before publishing

Create an annotated tag that starts with `fork-v`, not `v`. A `v*.*.*` tag triggers the upstream
release workflow and must not be used for fork releases.

```bash
git tag -a "fork-v${fork_version}" -m "T3 Code fork ${fork_version}"
git show --no-patch "fork-v${fork_version}"
```

Creating the local tag does not publish anything. Never replace a remote tag. An explicitly approved
replacement of an unpublished local tag may be done only after the replacement artifacts pass every
verification above. Before pushing a branch or tag, or creating a GitHub Release, get explicit
approval. After approval, push only the fork tag and create a GitHub Release containing the verified
DMG and ZIP. Push the selected source branch only when the developer explicitly asks for that too.
Do not push or update `fork` for a release sourced from another branch. Do not publish npm packages,
deploy hosted channels, update `main`, or attach upstream auto-update metadata.

```bash
git push origin "fork-v${fork_version}"
gh release create "fork-v${fork_version}" "$dmg" "$zip" \
  --repo htylim/t3code \
  --title "T3 Code ${fork_version}" \
  --notes "Ad-hoc signed Apple Silicon fork build, without Developer ID or notarization. Back up ~/.t3/userdata and quit other T3 Code apps before launching."
```

After downloading the published artifacts, repeat the checksum and complete bundle-signature
checks. A bundled-server smoke test does not verify a quarantined desktop launch. Test the latter
only with authorization and isolated application state. Before any installed-app launch, back up `~/.t3/userdata` and quit every other T3 Code desktop app before launching the fork.

## Record downstream drift

Update `fork-journal.md` when a change creates or removes a meaningful difference from upstream.
Record the reason, scope, upstream baseline, and verification. Do not repeat commit-by-commit detail
that Git already preserves.

## License and distribution

T3 Code uses the MIT License. Keep its license and copyright notice in copies or distributions.
Treat branding, package names, application identifiers, hosted services, and release signing as
explicit product decisions before distributing the fork.
