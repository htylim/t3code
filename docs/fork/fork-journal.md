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
