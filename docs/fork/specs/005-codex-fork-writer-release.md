# Codex Fork Writer Release

## Status

Implemented on 2026-08-10 as a fork-only correction to native Codex thread forking.

## Problem

Codex app-server owns an exclusive writer for every native thread loaded in its process. A
successful `thread/fork` loads the new native thread in the source thread's app-server. T3 then
starts a separate app-server for the target T3 thread, and `thread/resume` fails because the first
process still owns the target writer.

Sharing one app-server between the two T3 threads is not valid. Each T3 thread receives its own MCP
credential and thread-control scope when its provider process starts.

## Decision

After Codex returns a successful native fork cursor, `CodexAdapter` closes and removes the source
session before reporting success. T3 already persists the source cursor and persists the target
cursor before publishing the copied target thread, so either side starts a fresh app-server and
resumes lazily on its next prompt.

The source app-server stays open when native forking fails. Other providers keep their existing
lifecycle.

Forking is also rejected while the source reports background liveness. Closing a Codex process
while one of its child agents is still working or being monitored would interrupt valid work.

## Downstream Scope

- Codex-only process release in `apps/server/src/provider/Layers/CodexAdapter.ts`.
- Existing client eligibility and authoritative server fork checks now include background liveness.
- No provider contract, orchestration event, database schema, or target-thread format changes.
- No changes to Claude Agent, OpenCode, Cursor, or Grok adapters.

This keeps the correction at the adapter boundary and in the fork-owned orchestration path, which
minimizes conflicts when upstream provider and client code is merged.

## Regression Coverage

- A successful Codex fork returns the target cursor, closes the source runtime, and removes the
  source adapter session.
- A failed Codex fork leaves the source runtime and adapter session active.
- Client eligibility rejects both working and monitored background-agent states.
- The authoritative server check rejects background work before invoking the provider fork.
