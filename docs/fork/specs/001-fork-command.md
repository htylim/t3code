# `/fork` Command Implementation Plan

## Status

Frozen implementation plan created on 2026-08-04. After approval, only checkbox state may change;
the codebase remains the source of truth.

## Overview

Add a T3-owned `/fork` composer command that creates a new canonical thread from the current
provider head while the source has no work in flight. The fork copies the visible conversation,
preserves the provider's native context, shares the source workspace, and leaves the source thread
unchanged. The target is stored as an ordinary thread with a copied timeline and a changed title.
T3 stores no fork marker or source relationship in the target, its projections, or the event log.

The first release supports Codex, OpenCode, and Claude Agent. Cursor and Grok remain unsupported
until their ACP agents advertise and pass tests for the unstable `session/fork` capability.

## Desired User Experience

1. A user opens an eligible persisted thread backed by a supported provider.
2. `/fork` appears in composer autocomplete.
3. Selecting `/fork`, or sending exactly `/fork` with optional surrounding whitespace, creates a
   target thread and navigates to it.
4. The target shows the source transcript through the fork point.
5. The target uses a distinct native provider session but the same project, branch, checkout, and
   worktree path as the source.
6. The target starts active even when its copied history is old enough to auto-settle. Its first
   real turn clears that ordinary active override through T3's existing activity handling.
7. The source remains unchanged and can continue independently at the conversation level.
8. If native forking fails, the source remains unchanged, no target thread appears, and the composer
   shows a clear error so the user can retry.

`/fork` is an action, not a message. T3 must never send an intercepted `/fork` to the provider.

## Current State Analysis

- Web and mobile hard-code `/model`, `/plan`, and `/default`; `/fork` is absent
  (`apps/web/src/components/chat/ChatComposer.tsx`,
  `apps/mobile/src/features/threads/ThreadComposer.tsx`).
- Provider-advertised slash commands only insert text into the composer. They do not perform T3
  orchestration (`apps/web/src/components/chat/ChatComposer.tsx`).
- The generic provider adapter supports start, send, interrupt, read, and rollback, but not fork
  (`apps/server/src/provider/Services/ProviderAdapter.ts`).
- Codex's generated protocol already includes `thread/fork`
  (`packages/effect-codex-app-server/src/_generated/meta.gen.ts`).
- OpenCode's SDK includes `session.fork`, and T3 already uses it internally when a resumed session
  moves to another working directory (`apps/server/src/provider/Layers/OpenCodeAdapter.ts`).
- Claude Agent SDK exports `forkSession`, which returns a new resumable session ID
  (`@anthropic-ai/claude-agent-sdk/sdk.d.ts`).
- ACP exposes unstable `session/fork`, but Cursor and Grok do not currently negotiate or expose the
  capability through their adapters (`packages/effect-acp/src/client.ts`,
  `apps/server/src/provider/acp/AcpSessionRuntime.ts`).
- Projected message and activity IDs are global primary keys. A visible transcript copy therefore
  needs deterministic target IDs; source IDs cannot be reused
  (`apps/server/src/persistence/Migrations/005_Projections.ts`).
- Checkpoint refs are thread-scoped. Source checkpoint rows cannot be copied to the target
  (`apps/server/src/checkpointing/Utils.ts`).
- Shared worktrees are already supported by cleanup and checkpoint branch-drift logic
  (`apps/web/src/worktreeCleanup.ts`,
  `apps/server/src/orchestration/Layers/CheckpointReactor.ts`).

## Fixed Product Decisions

| Area                 | Decision                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| Fork point           | Current provider head, only while the source has no work in flight               |
| Transcript           | Copy completed messages, historical activities, and attachment files             |
| Plans                | Do not copy actionable proposed-plan state                                       |
| Checkpoints          | Do not copy source checkpoint summaries or refs; capture a new target baseline   |
| Workspace            | Share source project, branch, checkout, and `worktreePath`                       |
| Native session       | Create a distinct provider session and durable resume cursor                     |
| Title                | `${source.title} (fork)`                                                         |
| Source state         | Never mutate source conversation or checkpoint history                           |
| Lineage              | Store no fork marker or source relationship in target events, projections, or UI |
| Navigation           | Navigate to the canonical target after the complete fork operation succeeds      |
| Source lifecycle     | Reject deleted and archived threads; ignore Settled-list classification          |
| Work in flight       | Reject starting/running turns, queued turn starts, approvals, and user input     |
| Other session states | Attempt provider-binding recovery; reject cleanly if recovery fails              |
| Target lifecycle     | Start explicitly active; let the first real turn clear the existing override     |
| Unsupported provider | Hide autocomplete entry and reject manually typed exact `/fork`                  |
| Arguments            | `/fork anything` is ordinary provider input                                      |
| Attachments/context  | `/fork` with attachments or other composer context is ordinary provider input    |
| Clients              | Web and mobile; desktop inherits web                                             |
| Other entry points   | No Settings, command-palette, sidebar, or keybinding entry in v1                 |

Every decision-matrix row above is covered by a named test in the phases below.

### Fork Eligibility

Fork eligibility is separate from T3's Settled-list classification. Manual settle/unsettle choices,
inactivity timers, and pull-request state do not make a provider fork safe or unsafe. Do not call
`effectiveSettled` or inspect `settledOverride` or `settledAt` when deciding whether `/fork` is
available.

A source is eligible only when all of these are true:

- It is a persisted, non-deleted, non-archived thread rather than a draft.
- Its bound provider instance advertises native fork support.
- It has a durable native provider binding that ProviderService can recover.
- Its session is not `starting` or `running`, its latest turn is not `running`, and it has no queued
  turn start.
- It has no pending approval or user-input request.

The non-live session states `idle`, `ready`, `interrupted`, `stopped`, and `error` may proceed to
provider-binding recovery. Recovery decides whether the native source can actually be forked. The
client mirrors these checks to hide or reject `/fork` early; the server repeats them under the
per-source lock and remains authoritative.

## What We Are Not Doing

- Forking from an arbitrary historical turn or message.
- Copying dirty files into a new Git worktree.
- Copying or rewriting historical checkpoint refs and turn diffs.
- Automatically merging workspace changes between the source and target.
- Sending `/fork` through provider slash-command text handling.
- Enabling Cursor or Grok without negotiated ACP capability and adapter tests.
- Adding a general thread-duplication button outside the composer.
- Persisting a fork marker or source relationship anywhere in the target's durable state.

## Implementation Approach

Use a client-generated target `ThreadId` and a `thread.fork` server operation. The source ID exists
only in the request and in-memory operation. The server serializes the fork against source-thread
mutations, checks that no source work is in flight, reads one authoritative snapshot, performs the
native provider fork, captures the target baseline, and then dispatches one internal copy command.

The copy command emits only event types and payload shapes already understood by upstream:
`thread.created`, `thread.unsettled`, `thread.message-sent`, `thread.activity-appended`, and
`thread.session-set`. The `thread.unsettled` event uses reason `user`, keeping the new target active
even when its copied history is older than the auto-settle window. The events contain the copied
target data but no source ID or fork marker. Existing projectors create an ordinary target thread;
no projector reads from the source while replaying the target events.

Every target-owned durable identity is new. Copied events, messages, activities, attachments,
provider bindings, and checkpoint refs must not reuse source-owned IDs or storage. Remap references
between copied records to their target IDs and clear references to omitted historical turn,
checkpoint, approval, input, and proposed-plan records. Plain values such as message text,
timestamps, filenames, and model settings may remain equal. The project and worktree are the only
deliberately shared resources.

The target shares the source `worktreePath`. This is deliberate: it preserves uncommitted files and
matches provider `/fork` semantics.

Provider-side success and T3 event persistence are not one transaction. To narrow the crash window,
`ProviderService.forkSession` persists the target runtime binding under the client-generated target
ID before reporting success. The client retains that ID when a request fails ambiguously. A retry
with the same ID reuses the binding instead of invoking the native fork twice. The target becomes
visible only after the ordinary target event batch commits.

## Domain Model

Add these transient operation contracts:

- Client/server operation `thread.fork`:
  `sourceThreadId`, `threadId` (target), `commandId`, `createdAt`.
- Internal command `thread.copy.create`: authoritative source snapshot, target metadata, remapped
  timeline and attachment IDs, and the ready target session returned by ProviderService.

Define `ClientOrchestrationOperation` as the transport union of the existing
`ClientOrchestrationCommand` and `thread.fork`. Reuse the existing WebSocket
`orchestration.dispatchCommand` RPC and HTTP `/api/orchestration/dispatch` endpoint; do not add a
fork-only transport or authorization path. After existing authentication and normalization, both
transports call one shared `dispatchClientOperation` boundary function. It routes `thread.fork` to
`ThreadForkService` and delegates every ordinary command to `OrchestrationEngine`.

`thread.fork` is deliberately not part of the pure `OrchestrationCommand` union accepted by
`OrchestrationEngine`. Provider calls, attachment copies, and checkpoint capture stay in
`ThreadForkService`; only the final internal `thread.copy.create` command enters the engine.

The internal command is not persisted. Its decider emits only the existing `thread.created`,
`thread.unsettled`, `thread.message-sent`, `thread.activity-appended`, and `thread.session-set`
events. No new event type, fork descriptor, fork status, source ID, or fork-specific projection
column is persisted.

The client command never accepts provider, model, workspace, title, or source-history payloads.
Those values are derived from authoritative server state to prevent stale or forged copies.

## Phase 1: Operation Contracts and Pure Copy Events

### Overview

Define the fork request, internal copy command, invariants, environment capability negotiation, and
pure mapping to existing events. No provider call occurs in this phase.

### Why This Phase Can Be Validated Independently

The schemas and decider can prove that valid server-derived copy commands produce deterministic,
upstream-compatible events without persisting lineage.

### Changes Required

> **TDD ordering**: Add and run the tests below before changing implementation files.

#### 1. Tests (RED)

**Files**:

- `packages/contracts/src/orchestration.test.ts`
- `packages/contracts/src/server.test.ts`
- New `packages/contracts/src/environment.test.ts`
- `apps/server/src/environment/ServerEnvironment.test.ts`
- New `apps/server/src/orchestration/decider.copy.test.ts`
- `apps/server/src/orchestration/projector.test.ts`

**Named tests**:

- `decodes the thread.fork operation with source and target ids`
- `rejects thread.fork payloads with the same source and target id`
- `accepts thread.fork through the existing WebSocket dispatch payload`
- `accepts thread.fork through the existing HTTP dispatch payload`
- `defaults provider thread-fork support to false for legacy snapshots`
- `decodes advertised provider thread-fork support`
- `treats an absent environment threadFork capability as unsupported`
- `decides an ordinary target copy from authoritative source data`
- `changes only the title while preserving model modes branch and worktree`
- `rejects a target thread id that already exists`
- `keeps command retries idempotent through the existing command receipt`
- `emits only existing upstream event types and payloads`
- `persists no source id fork marker or fork-specific status`
- `remaps every target-owned id and clears references to omitted source records`
- `emits an ordinary user-unsettled event for the target`
- `projects the copy as an ordinary ready active thread without changing the source`

#### 2. Implementation (GREEN)

**Files**:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/environment.ts`
- `packages/contracts/src/environmentHttp.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/server.ts`
- `apps/server/src/environment/ServerEnvironment.ts`
- `apps/server/src/environment/ServerEnvironment.test.ts`
- `apps/server/src/orchestration/commandInvariants.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/projector.ts`

**Changes**:

- Add the external `thread.fork` operation and `ClientOrchestrationOperation` transport union; use
  that union as the existing WebSocket and HTTP dispatch payload while keeping `thread.fork` out of
  the engine's `OrchestrationCommand` union.
- Add the internal copy command; add no event type.
- Advertise optional environment capability `threadFork: true`.
- Add provider snapshot capability `supportsThreadFork` with a false decoding default.
- Validate distinct IDs and target absence in the pure command boundary.
- Map server-derived metadata and copied timeline items to existing target events.
- Emit `thread.created`, then `thread.unsettled` with reason `user`, one `thread.message-sent` per
  copied message, one `thread.activity-appended` per copied activity, and one ready
  `thread.session-set` event.
- Preserve copied message timestamps. The ordinary user-unsettled override, not rewritten history,
  keeps the target active until its first real turn. Existing turn-start activity clears the
  override; add no fork-specific cleanup path.
- Do not emit historical `thread.turn-start-requested` events because they are provider intents.
- Keep `latestTurn` empty so the next prompt is the target's first real turn.

### Success Criteria

#### Automated Verification

- [x] Phase 1 tests fail before implementation for the intended missing-schema/behavior reasons:
      `vp test run packages/contracts/src/orchestration.test.ts packages/contracts/src/server.test.ts packages/contracts/src/environment.test.ts apps/server/src/environment/ServerEnvironment.test.ts apps/server/src/orchestration/decider.copy.test.ts apps/server/src/orchestration/projector.test.ts`
- [x] The same Phase 1 selector passes after implementation.
- [x] Targeted typechecks pass:
      `vp run --filter @t3tools/contracts --filter t3 typecheck`
- [x] Formatting passes by running `vp fmt --check` with every file listed under Phase 1
      Implementation as explicit arguments.

#### Manual Verification

- [x] Inspect one decoded legacy environment/provider snapshot and confirm fork remains hidden.
- [x] Inspect the complete decided event batch and confirm every event type exists upstream and no
      event contains the source ID or a fork marker.

**Implementation Note**: Pause for human confirmation after this phase before Phase 2.

---

## Phase 2: Native Provider Forking and Durable Target Binding

### Overview

Extend the provider boundary and implement native head-fork support for Codex, OpenCode, and Claude.
Persist an independent target resume cursor. Mark Cursor and Grok unsupported.

### Why This Phase Can Be Validated Independently

Each adapter can fork a mocked native session and return a resumable cursor without orchestration or
UI involvement. ProviderService tests can prove routing, target-ID idempotency, and persistence.

### Changes Required

> **TDD ordering**: Add and run the tests below before changing implementation files.

#### 1. Tests (RED)

**Files**:

- `apps/server/src/provider/Layers/CodexSessionRuntime.test.ts`
- `apps/server/src/provider/Layers/CodexAdapter.test.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
- `apps/server/src/provider/Layers/ProviderService.test.ts`
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts`

**Named tests**:

- `Codex forks the current provider thread at its head`
- `Codex returns the forked thread id as a resume cursor`
- `Codex propagates thread/fork protocol failures`
- `OpenCode forks the current session in the requested directory`
- `OpenCode returns the forked session id as a versioned resume cursor`
- `OpenCode rejects a fork response with no session payload`
- `Claude forks the durable resume session in the requested directory`
- `Claude returns a target cursor without carrying resumeSessionAt`
- `Claude preserves durable turnCount when the recovered in-memory transcript is empty`
- `Claude rejects a source with no valid durable native session id`
- `Claude maps SDK fork rejection to session/fork request error`
- `ProviderService routes fork through the source provider instance`
- `ProviderService recovers a stopped source session before forking`
- `ProviderService persists target binding before reporting success`
- `ProviderService reuses an existing target binding instead of forking twice`
- `ProviderService rejects unsupported Cursor and Grok forks`
- `provider snapshots advertise fork only for Codex OpenCode and Claude`

#### 2. Implementation (GREEN)

**Files**:

- `packages/contracts/src/provider.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- Provider-specific adapter service types under `apps/server/src/provider/Services/`
- `apps/server/src/provider/Services/ProviderService.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- Cursor and Grok adapters/providers for explicit unsupported capability
- Provider snapshot/registry code that publishes `supportsThreadFork`

**Changes**:

- Add adapter capability `sessionFork: "native" | "unsupported"`.
- Add `forkSession({ sourceThreadId, targetThreadId, cwd })` returning only a provider-specific
  `resumeCursor`; do not duplicate the native ID in another field.
- Codex calls `thread/fork` with source native thread ID and `cwd`, then returns
  `{ threadId: response.thread.id }`.
- OpenCode calls `client.session.fork` and returns
  `{ schemaVersion: 1, sessionId: response.data.id }`.
- Claude injects/calls SDK `forkSession` and returns
  `{ threadId: targetThreadId, resume: result.sessionId, turnCount }` without `resumeSessionAt`.
- ProviderService recovers the source binding, verifies the same provider instance, performs the
  native fork, and persists the target binding before the target thread is published.
- If a binding for the target thread ID already exists, recover it rather than invoking native fork.
- Return the ready session value needed by the later ordinary `thread.session-set` event.
- Use a typed operation-specific unsupported error; do not reuse the missing-driver error.

### Success Criteria

#### Automated Verification

- [x] Phase 2 tests fail before implementation for missing fork methods/capabilities:
      `vp test run apps/server/src/provider/Layers/CodexSessionRuntime.test.ts apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/OpenCodeAdapter.test.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/provider/Layers/ProviderService.test.ts apps/server/src/provider/Layers/ProviderRegistry.test.ts`
- [x] The same Phase 2 selector passes after implementation.
- [x] No Phase 1 tests regress using the Phase 1 selector.
- [x] Server typecheck passes: `vp run --filter t3 typecheck`.
- [x] Formatting passes by running `vp fmt --check` with every file listed under Phase 2
      Implementation as explicit arguments.

#### Manual Verification

- [x] Inspect mocked request payloads and confirm all three providers fork the head, not a historical
      turn.
- [x] Confirm the source and target provider resume cursors differ.

**Implementation Note**: Pause for human confirmation after this phase before Phase 3.

---

## Phase 3: Atomic Fork Operation and Ordinary Target Materialization

### Overview

Coordinate source validation, native provider forking, target baseline capture, and one atomic batch
of existing target events. The target does not exist until all prerequisite side effects succeed.

### Why This Phase Can Be Validated Independently

Server integration tests can run the operation without a client and prove that success produces an
ordinary replayable thread while failure produces no partial target or fork-only durable data.

### Changes Required

> **TDD ordering**: Add and run the tests below before changing implementation files.

#### 1. Tests (RED)

**Files**:

- New `apps/server/src/orchestration/Layers/ThreadForkService.test.ts`
- New `apps/server/src/orchestration/ClientOperationDispatcher.test.ts`
- New `apps/server/src/orchestration/http.test.ts`
- `apps/server/src/orchestration/Normalizer.test.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`
- `apps/server/src/server.test.ts`

**Named tests**:

- `fork operation rejects a missing deleted archived or draft source`
- `fork operation rejects starting running and queued-turn sources`
- `fork operation rejects sources waiting for approval or user input`
- `fork operation accepts non-live session states when provider binding recovery succeeds`
- `fork operation rejects a source whose provider binding cannot be recovered`
- `fork operation serializes against mutations on the same source`
- `fork operation derives all copy data from one authoritative snapshot`
- `fork operation performs the native fork before publishing the target`
- `fork operation publishes no target when the native fork or baseline fails`
- `fork operation reuses a target binding when the same target id is retried`
- `shared dispatcher routes thread.fork to ThreadForkService and not OrchestrationEngine`
- `shared dispatcher routes ordinary commands to OrchestrationEngine`
- `normalizes thread.fork without admitting it to the engine command union`
- `WebSocket dispatch routes thread.fork through the shared dispatcher with operate scope`
- `HTTP dispatch routes thread.fork through the shared dispatcher with operate scope`
- `fork operation emits only upstream-known event types`
- `target event batch contains no source id fork marker or fork status`
- `copy events preserve completed messages with deterministic target ids`
- `copy events preserve historical activities with deterministic target ids`
- `copy events use deterministic target-owned attachment ids`
- `copy operation duplicates attachment files under their target-owned ids`
- `copy operation reuses target attachment copies on an idempotent retry`
- `source deletion and revert leave fork attachment copies readable`
- `fork deletion and revert leave source attachments readable`
- `copy failure removes partial target-owned attachment files`
- `copy events exclude historical turn intents checkpoints approvals input and actionable plans`
- `copy events leave target latestTurn empty`
- `old copied history projects truthful shell summaries and an active target`
- `first target turn clears the active override through existing activity handling`
- `copy events replay without reading the source and reproduce the same target`
- `copy events leave source rows byte-for-byte unchanged`
- `fork baseline uses a target-namespaced ref and the shared source cwd`
- `first target turn diff starts from the fork baseline`
- `lost success response retries through the existing command receipt without duplicating work`
- `ordinary copied target survives restart and accepts a new turn`

#### 2. Implementation (GREEN)

**Files**:

- New `apps/server/src/orchestration/Services/ThreadForkService.ts`
- New `apps/server/src/orchestration/Layers/ThreadForkService.ts`
- New `apps/server/src/orchestration/ClientOperationDispatcher.ts`
- `apps/server/src/orchestration/Normalizer.ts`
- `apps/server/src/orchestration/http.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/checkpointing/CheckpointStore.ts`
- `apps/server/src/checkpointing/Utils.ts`
- `apps/server/src/attachmentStore.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/server.ts`

**Changes**:

- Add one server-side fork operation with a per-source lock shared with source-thread mutations.
- Widen only the existing WebSocket and HTTP dispatch payloads to `ClientOrchestrationOperation`.
  Keep their current orchestration-operate authorization and command-readiness behavior; add no
  fork-only RPC method or endpoint.
- Add one shared `dispatchClientOperation` boundary function used by both transports after
  normalization. Route `thread.fork` to `ThreadForkService`, route every ordinary command to
  `OrchestrationEngine`, and map fork failures to the existing sanitized dispatch error contract.
- Keep the existing WebSocket-only bootstrap-turn preparation ahead of this boundary; do not pull
  unrelated worktree/setup orchestration into the fork change.
- Validate source existence, persistence, deletion/archive state, provider support, distinct IDs,
  and target absence before side effects. Do not use Settled-list state as an eligibility signal.
- Under the per-source lock, reject a `starting` or `running` session, a running latest turn, a
  queued turn start, or a pending approval or user-input request.
- For `idle`, `ready`, `interrupted`, `stopped`, and `error` sessions, continue to provider-binding
  recovery and reject without publishing a target if the durable native source cannot be recovered.
- Capture one authoritative source snapshot and derive title, model, modes, branch, cwd, messages,
  activities, and attachments on the server.
- Copy only completed messages and historical activities from that snapshot; do not copy pending or
  actionable state.
- Assign deterministic target-owned IDs to copied attachments and copy each attachment file to its
  target-owned path. Never put a source-owned attachment ID in a target event.
- Make attachment copying idempotent for the client-generated target thread ID. Reuse a matching
  target file on retry and remove partial target-owned files when the fork definitively fails before
  target event persistence.
- Perform the native provider fork and persist its target binding before publishing the target.
- Capture a target-namespaced checkpoint baseline in the shared cwd before publishing the target.
- Dispatch one internal copy command whose event batch contains only `thread.created`,
  `thread.unsettled`, `thread.message-sent`, `thread.activity-appended`, and `thread.session-set`.
- Emit `thread.unsettled` with reason `user` after target creation. Preserve the original copied
  message timestamps and project `latestUserMessageAt` from them while pending approval/input counts
  and actionable-plan state remain empty. The target must remain active even when those timestamps
  exceed the auto-settle window.
- Rely on the existing turn-start activity path to clear the target's active override on its first
  real turn. Do not add fork-specific override cleanup.
- Add deterministic ID helpers for copied messages, activities, and attachments. Remap internal
  references to copied target records; clear references to records that are not copied.
- Do not emit historical `thread.turn-start-requested` or `thread.turn-diff-completed` events. They
  are provider/checkpoint intents, not inert history. Leave `latestTurn` empty.
- Append and project the ordinary target events atomically. Replay must use event payloads only and
  must never query the source thread.
- If a prerequisite fails, return a sanitized operation error and publish no target thread.
- If persistence succeeds but the response is lost, let the existing command receipt return the
  canonical target on retry. If native success precedes persistence failure, reuse the existing
  target binding for the same target ID.

### Success Criteria

#### Automated Verification

- [x] Phase 3 tests fail before implementation for missing operation/materialization behavior:
      `vp test run apps/server/src/orchestration/Layers/ThreadForkService.test.ts apps/server/src/orchestration/ClientOperationDispatcher.test.ts apps/server/src/orchestration/http.test.ts apps/server/src/orchestration/Normalizer.test.ts apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts apps/server/src/orchestration/Layers/CheckpointReactor.test.ts apps/server/src/server.test.ts`
- [x] The same Phase 3 selector passes after implementation.
- [x] No Phase 1 or Phase 2 selectors regress.
- [x] No migration, fork-specific projection column, or fork-only event type is added.
- [x] Server typecheck passes: `vp run --filter t3 typecheck`.
- [x] Formatting passes by running `vp fmt --check` with every file listed under Phase 3
      Implementation as explicit arguments.

#### Manual Verification

- [x] Inspect target events and confirm their types and payloads decode with the upstream event
      union and contain no source ID or fork marker.
- [x] Inspect source and target SQLite rows and confirm the target is indistinguishable from an
      ordinary active thread except for its copied content, title, provider cursor, and checkpoint
      baseline.
- [x] Confirm a target copied from history older than the auto-settle window stays in the active
      sidebar section, then follows normal settlement behavior after its first real turn.
- [x] Confirm source and target share a workspace but have distinct checkpoint refs and provider
      resume cursors.

**Implementation Note**: Pause for human confirmation after this phase before Phase 4.

---

## Phase 4: Shared Client Operation and Web/Mobile `/fork` UX

### Overview

Expose one client-runtime fork operation, intercept exact `/fork`, add capability-aware autocomplete,
and provide matching web/mobile progress, errors, draft handling, and navigation.

### Why This Phase Can Be Validated Independently

Pure parser/action tests can prove every command interpretation and capability branch. Focused client
tests can prove dispatch and navigation against the completed server contract.

### Changes Required

> **TDD ordering**: Add and run the tests below before changing implementation files.

#### 1. Tests (RED)

**Files**:

- `packages/shared/src/composerTrigger.test.ts`
- New `packages/shared/src/composerCommands.test.ts`
- `packages/client-runtime/src/operations/commands.test.ts`
- New `packages/client-runtime/src/state/threadCommands.test.ts`
- `apps/web/src/composer-logic.test.ts`
- `apps/web/src/hooks/useThreadActions.test.ts`
- `apps/web/src/components/CommandPalette.logic.test.ts`
- `apps/web/src/keybindings.test.ts`
- New `apps/mobile/src/state/threadFork.test.ts`

**Named tests**:

- `parses standalone /fork case-insensitively with surrounding whitespace`
- `does not intercept /fork with arguments`
- `does not intercept /fork with attachments or additional composer context`
- `includes /fork for an eligible persisted thread on a supported environment and provider`
- `includes /fork for a recent ready thread that is not classified as settled`
- `ignores settle overrides inactivity and pull-request state when resolving fork eligibility`
- `omits /fork for a draft thread`
- `omits /fork for a deleted or archived thread`
- `omits /fork while a turn is starting running or queued`
- `omits /fork while approval or user input is pending`
- `omits /fork for an old server without threadFork capability`
- `omits /fork for a provider that does not support native fork`
- `resolves fork support from the bound session provider instance`
- `does not use an unsaved composer provider selection to resolve fork support`
- `client-runtime dispatches source and client-generated target ids`
- `client-runtime serializes duplicate fork actions for the same source`
- `web exact /fork bypasses provider turn submission`
- `web rejects /fork while the source has work in flight`
- `web navigates to the canonical target after command acceptance`
- `web clears the exact command on success and preserves it and the target id on failure`
- `mobile exact /fork bypasses the outbox`
- `mobile /fork with text follows the ordinary outbox path`
- `mobile rejects unsupported sources and sources with work in flight with a clear alert`
- `mobile replaces the source route with the canonical target on success`
- `mobile preserves the draft and target id on dispatch failure`
- `fork remains composer-only and is absent from command palette actions`
- `fork does not register a keybinding action`

#### 2. Implementation (GREEN)

**Files**:

- `packages/shared/src/composerTrigger.ts`
- New `packages/shared/src/composerCommands.ts` and package subpath export
- `packages/client-runtime/src/operations/commands.ts`
- `packages/client-runtime/src/state/threadCommands.ts`
- `apps/web/src/composer-logic.ts`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/hooks/useThreadActions.ts`
- `apps/mobile/src/features/threads/ThreadComposer.tsx`
- New `apps/mobile/src/state/threadFork.ts`
- `apps/mobile/src/state/use-thread-composer-state.ts`
- Mobile thread route/screen files needed to pass the shared action and navigate

**Changes**:

- Make `composerCommands.ts` the single source of truth for built-in command definitions,
  standalone command parsing, and command-menu construction so web and mobile do not drift.
- Move or delegate the existing shared standalone parser to `composerCommands.ts`, delete the web
  parser implementation and duplicate command types, and have both clients import the shared
  implementation. Keep web-only cursor expansion, inline-token handling, and `/model` trigger
  behavior in `composer-logic.ts`; do not broaden this phase into a full trigger-parser refactor.
- Intercept only standalone `/fork` with no attachments or extra context.
- Resolve support from environment capability plus the source session's bound provider instance.
- Resolve eligibility independently from Settled-list state. Ignore manual settle overrides,
  inactivity, and pull-request state; block drafts, deleted/archived threads, active or queued turns,
  pending approvals, and pending user input.
- Expose `threadEnvironment.fork` from shared client runtime with per-source serialization.
- Generate the target ID client-side, keep it across ambiguous retries, clear the command only after
  the full operation succeeds, and then navigate to the canonical target route.
- Show `Forking…` while dispatch is pending and suppress duplicate actions.
- Display explicit unsupported, draft, active-turn, and native-fork errors on the source; a failed
  operation creates no target thread.
- Keep command palette, Settings, sidebar actions, and keybindings unchanged.

### Success Criteria

#### Automated Verification

- [x] Phase 4 tests fail before implementation for missing parse/action/menu behavior:
      `vp test run packages/shared/src/composerTrigger.test.ts packages/shared/src/composerCommands.test.ts packages/client-runtime/src/operations/commands.test.ts packages/client-runtime/src/state/threadCommands.test.ts apps/web/src/composer-logic.test.ts apps/web/src/hooks/useThreadActions.test.ts apps/web/src/components/CommandPalette.logic.test.ts apps/web/src/keybindings.test.ts apps/mobile/src/state/threadFork.test.ts`
- [x] The same Phase 4 selector passes after implementation.
- [x] No earlier phase selector regresses.
- [x] Targeted typechecks pass:
      `vp run --filter @t3tools/shared --filter @t3tools/client-runtime --filter @t3tools/web --filter @t3tools/mobile typecheck`
- [x] Mobile static lint passes: `vp run lint:mobile`.
- [x] Formatting passes by running `vp fmt --check` with every file listed under Phase 4
      Implementation as explicit arguments.

#### Manual Verification

- [x] With explicit approval to launch clients, verify one integrated web flow for Codex, OpenCode,
      and Claude using `test-t3-app`.
- [ ] With explicit approval, verify one iOS or Android flow using `test-t3-mobile`.
- [x] Confirm desktop behavior through the inherited web surface; no separate Electron work is
      required.
- [x] Confirm the source and target can each receive a later prompt while sharing visible files.

**Implementation Note**: Pause for human confirmation after this phase before Phase 5.

---

## Phase 5: User, Maintainer, and Fork Documentation

### Overview

Document shipped behavior, provider support, shared-workspace semantics, architecture, and
downstream drift.

### Why This Phase Can Be Validated Independently

This phase changes documentation only. TDD does not apply; link and content checks prove completion.

### Changes Required

#### 1. Verification First

Before editing docs, record the missing links/sections with:

- `rg -n '/fork|thread forking' docs/user docs/internals docs/fork/fork-journal.md docs/README.md`

#### 2. Documentation

**Files**:

- New `docs/user/thread-forking.md`
- `docs/README.md`
- `docs/internals/providers.md`
- `docs/internals/glossary.md`
- `docs/fork/fork-journal.md`

**Changes**:

- Explain how to run `/fork`, supported providers, current-head behavior, work-in-flight blocks, and
  failures.
- Explain that a new target starts active even when its copied history is old, then returns to normal
  auto-settlement after its first real turn.
- State plainly that source and target share files.
- Explain that visible transcript history is copied but historical turn state and checkpoint diffs
  are not.
- Document the provider adapter and orchestration flow for maintainers.
- State that the implementation emits no new orchestration event type.
- Add `fork` vocabulary to the glossary and state that the result is an ordinary copied thread with
  no durable fork marker or source relationship.
- Record the intentional downstream feature in the fork journal with upstream baseline and focused
  verification.

### Success Criteria

#### Automated Verification

- [x] TDD is not applicable because this phase is documentation-only.
- [x] Every new relative documentation link resolves to an existing file, verified with explicit
      `test -f` checks for each link target.
- [x] Formatting passes: `vp fmt --check docs/user/thread-forking.md docs/README.md docs/internals/providers.md docs/internals/glossary.md docs/fork/fork-journal.md`.

#### Manual Verification

- [x] User docs describe shipped behavior without source paths or contributor commands.
- [x] Maintainer docs describe the request/service/provider/existing-event flow.
- [x] Fork journal records the reason, scope, upstream baseline, and verification.
- [x] No docs claim Cursor or Grok support.

**Implementation Note**: Pause for human confirmation after this phase. The implementation is then
complete.

---

## Cross-Phase Testing Strategy

This section complements, but does not replace, each phase's RED/GREEN selector.

### Unit Tests

- Operation/internal-command schema decoding and version-skew defaults.
- Service invariants and authoritative metadata derivation.
- Deterministic mapping to existing target events.
- Native cursor mapping for all three supported providers.
- Exact `/fork` parsing and capability-aware command visibility.

### Integration Tests

- Operation through provider success to an ordinary ready target.
- Old copied history materializes with truthful timestamps and an ordinary active override.
- The first target turn clears that override through existing activity handling.
- Projection replay produces the same target transcript.
- An ambiguous retry reuses a persisted target binding.
- Fork failure leaves the source unchanged and creates no target.
- First target turn resumes native fork context and diffs from the target baseline.

### Final Focused Verification

Do not run the repo-wide suite. Run only touched tests plus targeted package typechecks:

```sh
vp test run \
  packages/contracts/src/orchestration.test.ts \
  packages/contracts/src/server.test.ts \
  packages/contracts/src/environment.test.ts \
  packages/shared/src/composerTrigger.test.ts \
  packages/shared/src/composerCommands.test.ts \
  packages/client-runtime/src/operations/commands.test.ts \
  packages/client-runtime/src/state/threadCommands.test.ts \
  apps/server/src/orchestration/decider.copy.test.ts \
  apps/server/src/orchestration/projector.test.ts \
  apps/server/src/orchestration/Layers/ThreadForkService.test.ts \
  apps/server/src/orchestration/ClientOperationDispatcher.test.ts \
  apps/server/src/orchestration/http.test.ts \
  apps/server/src/orchestration/Normalizer.test.ts \
  apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts \
  apps/server/src/orchestration/Layers/CheckpointReactor.test.ts \
  apps/server/src/provider/Layers/CodexSessionRuntime.test.ts \
  apps/server/src/provider/Layers/CodexAdapter.test.ts \
  apps/server/src/provider/Layers/OpenCodeAdapter.test.ts \
  apps/server/src/provider/Layers/ClaudeAdapter.test.ts \
  apps/server/src/provider/Layers/ProviderService.test.ts \
  apps/server/src/provider/Layers/ProviderRegistry.test.ts \
  apps/web/src/composer-logic.test.ts \
  apps/web/src/hooks/useThreadActions.test.ts \
  apps/web/src/components/CommandPalette.logic.test.ts \
  apps/web/src/keybindings.test.ts \
  apps/mobile/src/state/threadFork.test.ts

vp run --filter @t3tools/contracts \
  --filter @t3tools/shared \
  --filter @t3tools/client-runtime \
  --filter t3 \
  --filter @t3tools/web \
  --filter @t3tools/mobile typecheck
```

## Performance Considerations

- Do not send copied transcript content from the client or echo it in the operation response; load
  the canonical target snapshot after success.
- Build and append the existing target event batch server-side in one transaction.
- Add no fork-only event type, payload field, projection field, or source relationship.
- Add no polling or continuously repainting progress UI.
- Clone one stable snapshot of completed history; do not create a live relationship between
  timelines.
- Copy attachment blobs under deterministic target-owned IDs so each thread retains ordinary
  thread-local cleanup semantics.
- Measure a large retained thread and ensure fork latency and shell payload size stay bounded.

## Security and Remote Behavior

- Derive source metadata and cwd on the server; never trust client-supplied paths.
- Apply the existing orchestration operate authorization scope to `thread.fork`.
- Route both WebSocket and HTTP dispatch through the shared server boundary; remote clients invoke
  the environment that owns the provider and filesystem exactly like local clients.
- Sanitize provider errors before projection and client display.
- Use the environment's provider instance and filesystem. Remote clients never invoke local CLIs.
- Do not encode localhost origins or bypass the authenticated environment dispatch paths.

## Migration and Compatibility

- No database migration or fork-specific projection column is added.
- The target uses existing thread, timeline, session, provider-runtime, and checkpoint storage.
- The event log contains only existing upstream event types and payload shapes; target events contain
  no source ID or fork marker.
- Old servers omit `environment.capabilities.threadFork`; new clients hide the command.
- Old provider snapshots omit `supportsThreadFork`; new clients treat them as unsupported.
- No event-log rewrite or provider-session migration is required.

## Rollback

- Existing forked target threads remain ordinary readable threads with persisted provider cursors.
- A downgraded client can continue the target conversation because it is stored as an ordinary
  thread.
- Do not delete native provider forks during rollback; they remain valid resumable sessions.

## References

- `docs/internals/overview.md`
- `docs/internals/providers.md`
- `packages/contracts/src/orchestration.ts`
- `apps/server/src/orchestration/decider.ts`
- `apps/server/src/orchestration/Layers/ThreadForkService.ts`
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.ts`
- `apps/server/src/provider/Services/ProviderAdapter.ts`
- `apps/server/src/provider/Layers/ProviderService.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `packages/client-runtime/src/operations/commands.ts`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/mobile/src/features/threads/ThreadComposer.tsx`
