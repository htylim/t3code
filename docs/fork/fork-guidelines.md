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

## Develop and verify

The repository requires Node 24 and Vite+ (`vp`):

```bash
curl -fsSL https://vite.plus | bash
vp i
vp run dev
```

`vp run dev` starts the server and web client and prints a one-time pairing URL. Use
`vp run dev:desktop` for desktop development.

## Build the Fork desktop app

Use a SemVer prerelease ending in `-fork` or `-fork.<identifier>` to select the downstream desktop
identity:

```bash
vp run dist:desktop:dmg --build-version 0.0.31-fork.1
```

The artifact is written to `release/` and installs as `T3 Code (Fork)` with the bundle identifier
`com.htylim.t3code.fork`. Fork builds deliberately keep using `~/.t3/userdata`, so they see the same
projects, threads, and settings as the upstream packaged app. The shared user-data lock means Fork
and upstream desktop apps must not run at the same time.

Fork artifacts do not include an upstream auto-update feed. Build and install a new artifact to
update the fork, incrementing the final fork version identifier for each release.

Run the smallest relevant tests, lint checks, and type checks for each change. Do not point a
development server at `~/.t3/userdata`, and do not set `VITE_HTTP_URL` or `VITE_WS_URL`.

## Record downstream drift

Update `fork-journal.md` when a change creates or removes a meaningful difference from upstream.
Record the reason, scope, upstream baseline, and verification. Do not repeat commit-by-commit detail
that Git already preserves.

## License and distribution

T3 Code uses the MIT License. Keep its license and copyright notice in copies or distributions.
Treat branding, package names, application identifiers, hosted services, and release signing as
explicit product decisions before distributing the fork.
