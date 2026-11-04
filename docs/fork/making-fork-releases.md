# Making Fork releases

Use this runbook when asked to publish a stable Fork desktop release. Take the tested
`fork` snapshot, promote it to `main`, and build that exact commit. Publish on
[htylim/t3code](https://github.com/htylim/t3code/releases).

The current release target is macOS Apple Silicon. Do not build mobile, publish npm
packages, or deploy upstream services. Do not run `.github/workflows/release.yml`.

An explicit request to publish the stable release authorizes the branch promotion,
tag push, and GitHub Release below. Otherwise, prepare and verify everything, then
ask before publishing. Do not ask again when the request already covers these steps.

## 1. Choose the source and version

Read the root instructions, [fork guidelines](fork-guidelines.md), and
[fork journal](fork-journal.md). Inspect the working tree and existing worktrees.
Preserve unrelated edits. Do not switch another session's checkout to a different branch.

```bash
git status --short
git worktree list
git remote -v
git fetch origin --tags
git rev-parse fork main origin/fork origin/main
git tag --list 'fork-v*' --sort=-version:refname
gh release list --repo htylim/t3code --limit 20
```

Record the original branch heads outside the repository. Choose the next unused
numeric version, such as `0.1.0-fork.33`. Check local tags, remote tags, releases,
and the last distributed build. Never reuse a published version or move its tag.
Ignore feature names when finding the highest numeric fork suffix.

Use `fork-v<version>` tags. Tags starting with `v` can trigger upstream publishing.

## 2. Commit and merge into fork

If this release includes new work, commit it on the task branch. Bring the latest
`fork` into that branch and resolve conflicts there. Test the combined result.

```bash
git add <files-that-belong-to-this-change>
git commit -m 'feat(fork): describe the change'
git merge origin/fork --no-edit
vp run check:changed origin/fork
```

Run focused tests for any conflicts or fixes. Do not add repo-wide checks.
Set `fork_checkout` to the absolute path of the clean checkout on `fork`.
Fast-forward it to the tested task branch. Do not reset or force-push it.

```bash
git -C "$fork_checkout" status --short
git -C "$fork_checkout" merge --ff-only <tested-task-branch>
release_commit="$(git -C "$fork_checkout" rev-parse HEAD)"
```

For a release with no new changes, verify the current `fork` snapshot and pin it
as `release_commit`. If a shared branch advances during this work, review and test
the new commits before including them.

## 3. Promote fork to main

Use a clean checkout on `main`. If it has no checkout, create a sibling worktree
with `git worktree add <absolute-sibling-path> main`. Set `main_checkout` to that path.

```bash
git -C "$main_checkout" status --short
git -C "$main_checkout" merge --ff-only "$release_commit"
git -C "$main_checkout" rev-parse HEAD
```

The printed SHA must equal `release_commit`. Stop if `main` has diverged; do not
rewrite it. Keep `main` at or behind `fork`. Both may point to the release commit.

## 4. Prepare the macOS artifacts

Write release notes outside the repository. State what changed and that updates
download a DMG for manual installation. The first feed-enabled release needs a
manual install for users on older Fork builds.

Run from `main_checkout`, using its absolute path. Load Cargo first.

```bash
source "$HOME/.cargo/env"
cd "$main_checkout"
git status --short
```

```bash
vp run release:fork:prepare --version "$fork_version" --arch arm64 --notes "$release_notes_file"
```

Set `fork_version` and `release_notes_file` before running that command. The notes
path must be absolute. Use `--arch both` only when Intel support is requested.

The helper builds local `main` in a disposable sibling worktree. It restores package
versions and writes `release/fork-v<version>/` in `main_checkout`. It does not publish.
Wait for a successful exit. Do not mistake old files or partial output for a build.

## 5. Verify before tagging

Check the exact version in the app, bundled server, and client. Check the bundle ID
`com.htylim.t3code.fork`, embedded commit, minimum macOS version, and `arm64` executable
and resource monitor. Confirm there is no upstream `app-update.yml` feed.

Verify the DMG with `hdiutil verify`. Extract the ZIP with `ditto -x -k` and mount the
DMG read-only. Run this on **both** contained apps:

```bash
codesign --verify --deep --strict --verbose=2 "$app"
```

Run the packaged server from a writable disposable app copy with fresh temporary
state. Use its Electron executable with `ELECTRON_RUN_AS_NODE=1`, the normal
`--require <app.asar>/apps/desktop/dist-electron/compileCache.cjs` preload, and
`<app.asar>/apps/server/dist/bin.mjs serve --base-dir <test-home> --no-browser`.
Choose a free loopback port. Check HTTP 200 for the client and its versioned asset.
Capture the process PID and stop only that process. Keep tokens out of shared logs.
Recheck the app signature after it exits. Runtime cache writes must not alter the app.

Check `SHA256SUMS-<version>.txt` from the artifact directory. Check that
`fork-desktop-update.json` names the exact version and built architectures.
Add the source SHA, minimum macOS version, and actual checks to the release notes.
Record any native GUI or browser-download checks that were not performed.

Do not replace the daily-use app as part of publishing. A server smoke check does
not prove a browser-downloaded app passes Gatekeeper. For a requested GUI test, use
the isolated setup in [Rehearse updates locally](fork-guidelines.md#rehearse-updates-locally).

## 6. Tag, upload, and publish

Create the tag at the verified commit. Push `fork`, `main`, and the tag without force.
The example below assumes both branches are at `release_commit`.

```bash
tag="fork-v${fork_version}"
git tag -a "$tag" "$release_commit" -m "T3 Code ${fork_version}"
git push --atomic origin fork main "$tag"
```

Create a draft and upload the complete asset set. Set `artifact_dir` to the absolute
`release/fork-v<version>` directory. Upload all requested architectures together.

```bash
gh release create "$tag" "$artifact_dir"/*.dmg "$artifact_dir"/*.zip \
  "$artifact_dir/SHA256SUMS-${fork_version}.txt" \
  "$artifact_dir/fork-desktop-update.json" \
  --repo htylim/t3code --verify-tag --target "$release_commit" --draft \
  --prerelease=false --title "T3 Code ${fork_version}" \
  --notes-file "$artifact_dir/release-notes.md"
```

Check the draft's assets and notes, then publish it:

```bash
gh release edit "$tag" --repo htylim/t3code --draft=false --prerelease=false --latest
```

Stable Fork releases must be **Latest**, despite the `-fork.N` version suffix.
Do not mark unrelated or integration releases Latest. The app reads
`https://github.com/htylim/t3code/releases/latest/download/fork-desktop-update.json`.

## 7. Check the published release

Download the public DMG, ZIP, manifest, and checksum file into a fresh directory.
Run `shasum -a 256 -c` there. Repeat the DMG and app signature checks on the downloads.
Check that the Latest manifest points to this version, its DMG URLs work, and the
remote tag resolves to `release_commit`. Confirm remote `main` contains that commit.

Include these installation steps in the release notes while builds lack Developer ID
signing and notarization:

1. Back up `~/.t3/userdata` and quit other T3 Code apps before replacing the app.
2. Open the DMG and drag Fork into Applications.
3. If macOS blocks it, click **Done** first. Then open **System Settings > Privacy & Security**
   and choose **Open Anyway**. Authenticate and confirm. Retry the launch if needed.
4. macOS may also ask to approve access to `t3code Safe Storage` in Keychain.

Do not disable Gatekeeper, strip quarantine, or re-sign a broken download to hide a
packaging failure. Investigate failed signature checks and publish a new version for a fix.

Remove disposable build worktrees and detach only the mounts created for this release.
Report the release URL, version, source SHA, architectures, checks, and any remaining limits.
