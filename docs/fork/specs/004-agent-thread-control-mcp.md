# Agent Thread Control MCP Product Plan

## Status

Product plan captured on 2026-08-08 and reconciled with the completed v1 implementation and its
authority hardening on 2026-08-09. It records the shipped behavior, product boundaries, and v1/v2
split. The implementation remains confined to the existing server MCP area plus capability,
credential, provider-session, and toolkit registration edits.

## Intent

Extend T3 Code's existing provider-scoped MCP server so an agent running in one T3 thread can
create and operate other threads in the same T3 environment.

The purpose is to make agent-directed workflows possible without adding a workflow engine. A
parent agent should be able to launch a reviewer, monitor it, read its findings, launch independent
fixers, monitor those fixers, and launch validation threads with different models or settings.

The MCP exposes ordinary T3 thread operations. Threads created or changed through MCP remain
normal T3 threads and appear in the existing web, desktop, and mobile clients.

## Example Workflow

1. A parent agent lists the available models and model options.
2. It starts a review thread with a selected model, effort, permission mode, interaction mode, and
   prompt.
3. It waits for the review thread through an event-driven monitoring tool.
4. When the review completes, it reads the final response or transcript and extracts the findings.
5. It starts reviewer, fixer, or validation children in its own existing workspace.
6. It keeps concurrent writing children to a minimum because they share that workspace.
7. It monitors the fixer thread IDs together.
8. It starts validation threads, potentially with a different provider, model, or effort.
9. It reads the final results and reports them to the user.

The parent keeps the returned thread IDs. T3 does not need to persist a parent-child graph for this
workflow.

## Fixed Product Decisions

| Area                  | Decision                                                                             |
| --------------------- | ------------------------------------------------------------------------------------ |
| MCP host              | Extend the existing T3 MCP server; do not create another MCP server                  |
| Control model         | Expose semantic T3 thread operations, not browser or pointer automation              |
| Environment boundary  | An MCP credential may operate only within its own T3 environment                     |
| Mutation boundary     | A credential may mutate only children it created during its provider session         |
| Authority ceiling     | A child or follow-up may not exceed the credential's provider-session runtime mode   |
| Availability          | Thread-control tools are available to provider sessions by default                   |
| Permissions setting   | No Off/Read/Operate setting in v1                                                    |
| Clients               | Created and updated threads remain ordinary threads visible to all existing clients  |
| Workflow ownership    | The parent agent owns workflow decisions and the list of child thread IDs            |
| Workflow engine       | Do not add a scheduler, DAG, durable monitor, or orchestration subsystem             |
| Lineage               | Do not persist parent, child, or spawned-by relationships                            |
| Search                | Provide project-scoped thread listing and metadata filtering, not transcript search  |
| Monitoring            | Monitor lightweight status and events; never poll or repeatedly read transcripts     |
| Worktrees             | Child creation stays in the caller's exact existing workspace or worktree            |
| Transcript v1         | Support one-time final-result, message, and transcript reads with bounded output     |
| Transcript v2         | Add efficient last-N and cursor-paginated reads without hydrating the whole thread   |
| Reasoning             | Do not promise hidden reasoning or reconstruct reasoning that T3 did not persist     |
| Destructive actions   | Omit delete, archive, checkpoint revert, and session stop from v1                    |
| User responses        | Omit approval and structured user-input responses from v1                            |
| Existing fork feature | Native conversation forking is outside this MCP v1                                   |
| Upstream impact       | Keep v1 confined to the existing MCP implementation; reduce scope before widening it |

## V1 Tool Surface

The names below are the intended public MCP names. The implementation plan may adjust a name only
when required for consistency with an existing MCP naming rule; it must preserve the operation's
meaning and scope.

### `thread_context`

Return the identity and working context of the calling provider session:

- Environment ID.
- Calling thread ID.
- Project ID and project workspace root.
- Current branch and worktree path.
- Provider instance, model selection, runtime mode, and interaction mode.

This gives the parent a safe default context for other tool calls without letting it select another
environment.

### `models_list`

List the provider instances and models currently available in the environment. Include the model
options needed to form a valid selection, such as provider-specific effort, reasoning, thinking,
variant, agent, or service-tier choices.

The tool output is the source of truth for model options. Callers must not assume that every
provider uses the same effort field or vocabulary.

### `threads_list`

List thread metadata, primarily to let an agent discover thread IDs. Support selecting a project
and filtering the lightweight list by relevant metadata such as:

- Active or archived visibility.
- Current execution status.
- Provider instance or model.
- Settled, snoozed, or pinned lifecycle state.
- Creation or update time where practical.

The result should include enough metadata to identify and choose a thread without loading its
messages or tool activity:

- Thread ID, project ID, and title.
- Provider instance, model, and selected options.
- Runtime and interaction modes.
- Branch and worktree path.
- Latest turn state and timestamps.
- Pending approval and pending user-input indicators.
- Background working or monitoring state.
- Settled, snoozed, pinned, and archived metadata.

Transcript-content search is not part of v1.

### `thread_status`

Return the lightweight current state of one thread without loading its transcript. The result must
distinguish at least:

- Idle or not yet running.
- Queued or starting work where T3 can identify it.
- Running.
- Waiting for approval.
- Waiting for user input.
- Completed.
- Interrupted.
- Error.

Return native background liveness separately when the provider still has agents or monitor tasks
alive after the foreground turn changes state. Completion must not be reported while actionable
approval, user input, or known background agent work remains.

Settlement is inbox lifecycle state and must remain separate from execution status.

### `threads_wait`

Wait efficiently for meaningful changes to one or more thread IDs.

Requirements:

- Use T3's event flow rather than repeatedly reading a transcript.
- Accept an optional sequence cursor returned by a prior start, status, or wait call.
- Return a new cursor with every response.
- Support a bounded timeout so the caller can renew the wait in another MCP call.
- Without a cursor, return immediately when a requested terminal or blocked condition is already
  true. With a cursor, match only relevant watched-thread transitions after that cursor.
- By default, wake for completion, interruption, error, approval, user input, or the end of known
  background work.
- Allow an optional progress mode that returns only lightweight activity summaries.
- Do not return on every streamed text token.
- Catch up bounded missed history and resynchronize only when a cursor is ahead or too stale to
  replay safely.
- Never load full messages, tool results, or transcript history merely to monitor status.

Repeated long-poll calls are expected. They are an agent-facing way to maintain an event-driven
watch, not transcript polling and not a durable server-side monitoring job.

### `thread_read`

Read persisted output from a thread when the caller actually needs its contents. V1 supports these
views:

- `final`: the final assistant response associated with the latest completed turn.
- `messages`: the visible user and assistant conversation.
- `transcript`: messages plus persisted plans, activities, tool calls, and errors. Persisted tool
  arguments and results are included only when explicitly requested.

Requirements:

- Reading is separate from monitoring. A normal parent workflow waits first and reads after a
  useful state transition.
- Bound the MCP response size and report truncation honestly.
- Permit full tool payloads only when requested and within the response bound.
- Do not expose transient streaming fragments as separate final messages.
- Do not claim to return hidden chain-of-thought or reasoning data that T3 did not persist.

V1 may internally hydrate the existing complete thread detail before selecting and bounding the
requested view. This is accepted because transcript reads are expected to be occasional, not part
of the monitoring loop.

### `thread_start`

Create a normal T3 thread and submit its first prompt.

The caller may select:

- Project and workspace fields, but they must resolve to the calling thread's own project and
  effective workspace.
- Provider instance and model.
- Provider-specific model options, including effort where supported.
- Runtime permission mode.
- Default or plan interaction mode.
- Title or title seed.
- Initial prompt.

Requirements:

- Return the new thread ID and a sequence cursor as soon as creation and prompt submission are
  accepted; do not wait for the agent to finish.
- Report separately and honestly whether the thread was created and whether its first prompt was
  accepted if a partial failure occurs.
- Never create, fetch, initialize, clean up, or delete a Git worktree.
- When a worktree path is supplied, it must already exist and belong to the expected project
  repository.
- Reject a project or workspace different from the calling thread even when it is otherwise valid.
- Reject a runtime mode broader than the calling provider session's credential ceiling.
- Starting a thread in an existing worktree does not copy uncommitted changes from another
  worktree. The caller is responsible for preparing the intended Git state first.

### `thread_send`

Send a user message to a child thread created by the same provider credential. Permit the same model
and mode choices a normal T3 follow-up can use, up to the credential's runtime-mode ceiling. If the
target is currently running, preserve T3's existing provider-specific steering or follow-up
behavior rather than inventing a new cross-provider guarantee.

Return acceptance and sequence information; do not wait for completion.

### `thread_interrupt`

Interrupt the current or specified active turn of a credential-owned child using T3's ordinary
interrupt behavior. Return the accepted operation and resulting cursor. The implementation plan
must explicitly decide how a provider session attempting to interrupt its own currently executing
MCP call is handled.

### `thread_update`

Expose non-destructive changes to credential-owned children needed for ordinary management:

- Settle and unsettle.
- Snooze and unsnooze.
- Pin and unpin.
- Rename or request ordinary title regeneration.
- Change model selection.
- Change runtime permission mode.
- Change default or plan interaction mode.

Do not include delete, archive, checkpoint revert, session stop, worktree management, or other
destructive lifecycle operations in v1.

## Monitoring and Reading Contract

Monitoring and reading are deliberately separate responsibilities:

```text
thread_start -> threadId + cursor
                    |
                    v
              threads_wait  <---- repeat after timeout or progress
                    |
             terminal/blocked state
                    |
                    v
               thread_read  ---- final findings or requested transcript
```

The monitor operates on thread summaries and event transitions. It must remain cheap even when the
target has a very large transcript. `thread_read` is a deliberate content retrieval operation and
may be more expensive in v1.

## Authority and Existing-Worktree Contract

Every provider credential records the runtime mode selected when its provider session starts. T3
already restarts a provider session when that mode changes, so the replacement credential receives
the new ceiling. The credential also keeps an in-memory set of the child thread IDs it created.
That set is revoked with the credential and is not persisted as product lineage.

Mutating tools require a target in that set. Starting or sending a turn also requires the requested
runtime mode to be no broader than the credential ceiling. A lower-authority caller therefore
cannot create an unrestricted child, promote a child, or send work to an existing unrestricted
thread. Approval and structured user-input responses remain user actions and are not exposed.

Child creation is limited to the calling thread's exact project and effective workspace. The MCP
still validates an explicitly supplied path and branch, but it rejects a different valid worktree.
For isolation, the user should start the parent in the desired worktree before delegating children.

The MCP does not create worktrees, run setup scripts, fetch remotes, select checkpoint refs, or clean
up failed worktrees. Review and validation children can safely share the parent workspace when
concurrent writes are not expected.

## Scope Boundaries

V1 is intentionally narrow to minimize drift from upstream:

- Add tools to the existing T3 MCP server.
- Reuse existing T3 read models and ordinary thread operations.
- Do not add a second transport, daemon, CLI, or external control service.
- Do not change persistence schemas or add projections.
- Do not add new durable thread relationships or workflow records.
- Do not add client UI, Settings, commands, keybindings, or mobile-specific behavior.
- Do not add provider-specific orchestration outside the behavior T3 already exposes.
- Do not automate the embedded browser or normal T3 UI to perform thread operations.
- Do not place a second implementation of normal client worktree or archive workflows inside MCP.
- If an operation cannot be supported cleanly through existing T3 capabilities, remove or narrow
  that operation rather than expanding v1 across upstream-heavy areas.

## V2 Transcript Requirement

V2 must make transcript retrieval efficient for large threads. It should support:

- “Give me the last N messages.”
- Cursor-based forward and backward pagination.
- Stable ordering across page requests.
- Filtering by message role, turn, activity or tool kind, and relevant time range.
- A lightweight final-response lookup.
- Optional full tool arguments and results without forcing them into ordinary message pages.
- Bounded database work and bounded output per request.
- No complete-thread hydration for a normal tail or page request.
- Honest continuation and truncation metadata.

V2 may require changes outside MCP because the existing thread-detail read is whole-thread. Those
changes must be planned separately and should provide reusable read capability rather than putting
persistence-specific queries inside MCP.

## Future Possibilities That Are Not Commitments

Only reconsider these after the v1 workflow is exercised:

- Transcript-content or tool-output search.
- Persisted parent-child lineage and orchestration graph views.
- A user-facing Off/Read/Operate permission setting.
- MCP-managed worktree creation or checkpoint-based workspace spawning.
- Native conversation forking through MCP.
- Archive, delete, session-stop, or checkpoint-revert tools.
- Durable server-side monitoring or workflow scheduling.

None of these should shape or delay v1.

## Implementation Plan

### Implementation principles

The implementation should be a thin MCP adapter over capabilities T3 already owns. The MCP layer
may validate and compose ordinary operations, but it must not become another orchestration layer.

Apply these rules throughout the work:

1. Keep all new MCP request schemas, response schemas, status derivation, response bounding, and
   handlers under `apps/server/src/mcp`.
2. Dispatch the existing orchestration commands through `OrchestrationEngineService`. Do not call
   provider adapters directly and do not reproduce provider-specific steering, interruption,
   approval, or user-input behavior.
3. Read lightweight metadata through `ProjectionSnapshotQuery`. Only `thread_read` may call the
   existing whole-thread detail query.
4. Read models from `ProviderRegistry`; its current snapshots and option descriptors are the model
   source of truth.
5. Use `OrchestrationEngineService.streamDomainEvents` for a live wait. Never inspect messages or
   activity payloads to decide whether a wait has completed.
6. Do not change `packages/contracts`, persistence tables, migrations, projections, client runtime,
   web, desktop, or mobile for v1. MCP-only schemas do not belong in the client/server contracts
   package because no client consumes them.
7. Do not extract or refactor the WebSocket bootstrap/worktree flow merely to share code with MCP.
   MCP does less: it accepts an already-existing workspace and dispatches create plus turn-start
   commands. This keeps the upstream diff small and avoids importing worktree creation behavior.
8. Before implementation, read `.repos/effect-smol/LLMS.md` in full and follow the repository's
   established Effect service, layer, typed-error, stream, and test patterns.

### Implemented file layout

Add one cohesive toolkit and one server-side service:

```text
apps/server/src/mcp/
  ThreadControlService.ts
  ThreadControlService.test.ts
  toolkits/threadControl/
    schemas.ts
    status.ts
    status.test.ts
    output.ts
    output.test.ts
    providerValidation.ts
    providerValidation.test.ts
    tools.ts
    handlers.ts
    handlers.test.ts
    registration.ts
```

Responsibilities:

- `schemas.ts` owns the MCP-only input, success, and failure schemas. It reuses branded IDs,
  `ModelSelection`, `RuntimeMode`, and `ProviderInteractionMode` from `@t3tools/contracts` rather
  than redefining domain types.
- `status.ts` is a pure mapping from `OrchestrationThreadShell` to the public execution status and
  lifecycle metadata.
- `output.ts` builds the three read views and applies the response byte budget.
- `providerValidation.ts` validates model selections against cached provider snapshots.
- `tools.ts` declares the ten tools, descriptions, annotations, and dependencies.
- `handlers.ts` checks the `thread-control` capability and delegates to `ThreadControlService`.
- `registration.ts` registers the toolkit with MCP-specific success and failure encoding.
- `ThreadControlService.ts` performs local-environment lookup, validation, command composition,
  status reads, live waiting, and transcript selection.

If implementation shows that `ThreadControlService.ts` remains readable without `status.ts` or
`output.ts`, keep those helpers in the service instead. Do not create files only to satisfy this
proposed tree.

Modify only these existing runtime files:

- `apps/server/src/mcp/McpInvocationContext.ts`: add `thread-control` to `McpCapability`. Leave the
  preview-specific `requireMcpCapability("preview")` behavior intact; thread-control handlers use
  their own typed capability check so preview error contracts do not widen.
- `apps/server/src/mcp/McpSessionRegistry.ts`: issue provider credentials with both `preview` and
  `thread-control` capabilities by default, record their runtime-mode ceiling, and track their
  in-memory child-control grants.
- `apps/server/src/provider/Layers/ProviderService.ts`: pass the provider session's runtime mode
  when issuing its MCP credential.
- `apps/server/src/mcp/McpHttpServer.ts`: merge the thread-control toolkit registration beside the
  preview toolkit on the existing `McpServer` and `/mcp` transport.

`apps/server/src/server.ts` should need no new transport or route. Its existing runtime dependency
layer already supplies the orchestration engine, projection query, provider registry, filesystem,
path, Git, clock, and crypto services required by the new toolkit. Only add an explicit layer
provision there if TypeScript proves a dependency is not already available; do not reshuffle the
runtime layer graph preemptively.

### Shared MCP conventions

#### Credential and environment scope

Every handler must obtain `McpInvocationContext` and require the `thread-control` capability before
reading or changing state. Tool inputs never accept an environment ID. All project and thread IDs
are resolved only through services in the server that authenticated the bearer credential, which
makes cross-environment operation impossible by construction.

The capability-denied error includes the calling environment, thread, provider session, and
provider instance IDs for diagnostics. It must not expose the bearer token or authorization header.

Mutation authority is narrower than environment access. `thread_start` grants its generated child
ID to the calling credential before dispatch. `thread_send`, `thread_interrupt`, and `thread_update`
reject any target not granted to that credential. Creation stays in the calling project and exact
effective workspace. Start, send, and runtime-mode updates reject modes above the credential's
ceiling. Credential revocation removes both the bearer token and its in-memory child grants.

#### Sequence cursors

A cursor is T3's global non-negative orchestration sequence, represented in public output as
`cursor`. It is a synchronization watermark, not a transcript cursor.

- Shell-backed discovery and status responses return the projection sequence observed while
  building the response. `models_list` has no orchestration cursor because provider snapshots use
  a separate live registry.
- Every accepted mutation returns the last accepted command sequence as `cursor`.
- `threads_wait` returns a cursor on condition, progress, resynchronization, and timeout responses.
- A cursor behind the head by at most 1,000 events uses the orchestration engine's existing bounded
  replay. MCP filters immediately to requested thread IDs and lightweight wait signals, advances
  past unrelated events silently, and never returns replayed payloads.
- A cursor ahead of the authoritative head, or behind it by more than 1,000 events, causes an
  immediate current-status resynchronization. No unbounded replay is attempted.
- A continuation wait matches only watched threads with a relevant signal after the supplied
  cursor. A terminal thread already reported at that cursor does not match again merely because it
  remains terminal.

This keeps the cursor global without letting unrelated multi-agent activity interrupt every wait.
The bounded replay may decode at most 1,000 existing events, projects or discards each immediately,
and requires no new persistence query, event index, or orchestration contract.

#### Limits

Use fixed, documented limits in `schemas.ts`:

| Input                       |                 Default |                              Maximum |
| --------------------------- | ----------------------: | -----------------------------------: |
| `threads_list.limit`        |                      50 |                                  200 |
| `threads_wait.threadIds`    |                     n/a |                        32 unique IDs |
| `threads_wait.timeoutMs`    |               30,000 ms |                            55,000 ms |
| Internal wait replay gap    |                     n/a |                  1,000 global events |
| `thread_read.maxBytes`      |            65,536 bytes |                        131,072 bytes |
| Initial or follow-up prompt | existing contract limit | `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` |

Reject invalid limits during schema decoding. Do not silently clamp them. Keep the wait maximum
below common 60-second MCP request deadlines so the agent can renew it cleanly.
`thread_read.maxBytes` also has a 4,096-byte minimum so its duplicated MCP text and structured
content envelope can always carry honest status and truncation metadata.

#### Tool annotations

Annotate read tools as read-only, idempotent, non-destructive, and closed-world:

- `thread_context`
- `models_list`
- `threads_list`
- `thread_status`
- `threads_wait`
- `thread_read`

`thread_update` is mutating but reversible/non-destructive. `thread_start`, `thread_send`, and
`thread_interrupt` are non-idempotent and must be marked open-world and destructive because they
can start agent work that changes files or external systems.

### Public status model

Return one of these execution statuses:

```text
idle
queued
starting
running
waiting_for_approval
waiting_for_user_input
completed
interrupted
error
```

Derive it only from `OrchestrationThreadShell`:

1. Pending approvals take precedence and produce `waiting_for_approval`.
2. Pending user input produces `waiting_for_user_input`.
3. When both are pending, use `waiting_for_approval` as the primary status and return
   `blockedOn: ["approval", "user_input"]` so neither condition is hidden.
4. `session.status === "starting"` produces `starting`.
5. `session.status === "running"` produces `running`.
6. A recent user message that has not yet been adopted by a turn produces `queued`. Mirror the
   existing shell rule: the message is newer than every latest-turn timestamp, the session is not
   in error, and the timestamp is within the existing two-minute adoption grace window. Keep this
   helper MCP-local rather than making the server depend on `packages/client-runtime`.
7. A session or latest turn in error produces `error`.
8. A session or latest turn interrupted produces `interrupted`.
9. Known `backgroundLiveness` produces `running` after foreground completion. Return the foreground
   result separately so callers can see that the foreground completed while background agents are
   still alive.
10. A completed latest turn with no blocker or background liveness produces `completed`.
11. A thread with no turn, live session, blocker, or background work produces `idle`.

Every status response also includes:

- Thread and project IDs.
- Active or archived visibility.
- `foregroundStatus` derived from the latest turn/session independently of blockers and background
  work.
- `blockedOn`, plus pending-approval and pending-user-input Boolean indicators.
- Background liveness separately as `working`, `monitoring`, or `null`.
- Latest turn ID and its requested, started, and completed timestamps when present.
- Session status and last error when present.
- Model selection, runtime mode, interaction mode, branch, and worktree path.
- Settlement override/settled timestamp, snooze timestamps and effective timer state, pin timestamp,
  archived timestamp, and update timestamp.
- The cursor used for the read.

Settlement never changes execution status. `settled` filtering in v1 means the explicit server
state `settledOverride === "settled"`; it does not attempt to duplicate the clients' auto-settle
calculation, which also depends on client settings and change-request state.

### Tool contracts and implementation

#### `thread_context`

Input: an empty object.

Implementation:

1. Read the calling thread shell from `ProjectionSnapshotQuery.getThreadShellById` using the thread
   ID in `McpInvocationContext`.
2. Read its project through `getProjectShellById`.
3. Return the credential's environment ID and provider instance ID, plus the calling thread's
   project, stored branch/worktree, effective workspace path, model selection, runtime mode,
   interaction mode, and current execution status.
4. Treat a missing calling thread/project as a typed consistency error. A live provider credential
   should not normally outlive either record.

The effective workspace path is `thread.worktreePath ?? project.workspaceRoot`. The response calls
the branch the T3-recorded branch; it does not run Git on every context read.

#### `models_list`

Input: optional `includeUnavailable`, defaulting to `true` so failures are diagnosable.

Implementation:

1. Read the cached `ProviderRegistry.getProviders` snapshot. Do not trigger provider refreshes or
   network probes.
2. Return each instance's ID, driver, display label, availability, enabled/installed state, runtime
   status, authentication status, model-change and interaction-mode capabilities, and models.
3. For every model return slug, labels, default/custom/legacy flags, and the exact
   `capabilities.optionDescriptors` array. This array is the only advertised vocabulary for effort,
   reasoning, thinking, variant, agent, service tier, and Boolean model options.

Mutation preflight uses the same snapshot. A model selection is valid only when:

- The provider instance exists, is available, installed, enabled, and not in an unusable state.
- The model slug appears in that instance's model list.
- Every supplied option ID exists on that model.
- A select option uses one of the advertised choice IDs and a Boolean option uses a Boolean value.
- No option ID appears more than once.

Missing optional selections remain missing; the provider's normal defaults apply. Do not invent a
cross-provider `effort` field.

#### `threads_list`

Input:

- Optional `projectId`, defaulting to the caller's project.
- `visibility`: `active`, `archived`, or `all`, defaulting to `active`.
- Optional arrays/values for execution status, provider instance, model slug, explicit settlement,
  snoozed state, pinned state, creation time, and update time.
- `limit`, defaulting to 50 and capped at 200.

Implementation:

1. Validate the selected project through `getProjectShellById`.
2. Read `getShellSnapshot`, `getArchivedShellSnapshot`, or both based on visibility.
3. Filter and sort in memory because these snapshots already exist for ordinary clients and carry
   no transcript bodies. Sort by `updatedAt` descending, then thread ID for stability.
4. Return compact status objects, `totalMatched`, `returnedCount`, and `truncated`.

Do not call `searchThreads`; that API includes message-content search, which is explicitly outside
this tool.

#### `thread_status`

Input: `threadId`.

Implementation:

1. Read the current sequence before reading the shell so the returned cursor can be behind the
   represented state but can never skip a later transition.
2. Try `getThreadShellById` for an active thread.
3. If absent, inspect the archived shell snapshot only to distinguish an archived thread from a
   missing/deleted thread.
4. Return the public status mapping without messages, plans, checkpoints, or activities.

#### `threads_wait`

Input:

- `threadIds`: one to 32 unique thread IDs.
- Optional `afterSequence` cursor.
- Optional `timeoutMs`.
- Optional `wakeOn`, whose values are `completed`, `interrupted`, `error`, `approval`,
  `user_input`, and `background_idle`. The default is all six.
- Optional `progress`, defaulting to `false`.

Output:

- `reason`: `condition`, `progress`, `timeout`, or `resynchronized`.
- `cursor` and `resynchronized`.
- Current lightweight status for every requested thread.
- Matched conditions by thread.
- When progress mode caused the wake, a bounded list of activity summaries containing only
  sequence, thread ID, event/activity kind, tone, summary, and timestamp. Never include payloads.

Race-safe algorithm:

1. Validate all thread IDs before waiting.
2. Create a scope-bound queue and attach a subscription to
   `OrchestrationEngineService.streamDomainEvents` before reading current status. Filter to the
   requested thread aggregate IDs immediately.
3. Read the authoritative head and a lightweight current snapshot. Without `afterSequence`, return
   immediately if a requested condition is already true.
4. If `afterSequence` is ahead of the head or more than 1,000 events behind it, return current
   status and matches with `reason: "resynchronized"`. Otherwise replay exactly the bounded gap,
   filter immediately to requested threads and lightweight wait signals, and deduplicate overlap
   with the live queue by sequence.
5. During catch-up and live monitoring, match current conditions only for watched threads with a
   relevant condition-changing signal after the supplied cursor. If progress mode is enabled, a
   bounded replayed progress summary may also return immediately.
6. Otherwise consume the live queue until a requested condition is true, progress mode sees a
   meaningful event, or the timeout expires. Coalesce a short burst before refetching statuses so
   streamed state changes do not cause one database read per event.
7. Ignore assistant message/delta events, context-window updates, and other token-level noise for
   progress wakes. Allow session transitions, turn completion/diff transitions, approval/user-input
   activities, provider failures, and tool/task lifecycle summaries.
8. Refetch shell status after a meaningful event; event type alone is not authoritative for final
   state. `background_idle` wakes only when a thread observed with background liveness returns to
   `null` during this wait.
9. Apply the timeout to the complete scoped operation, including subscription setup, the initial
   status snapshot, and the live wait. On timeout, return success with the last cursor and statuses
   that were coherently snapshotted together. Never publish an event cursor when the matching
   status refetch or bounded catch-up did not finish. A timeout is not a tool error.
10. If the deadline expires before any coherent initial status snapshot exists, return retryable
    `read_failed`; there is no truthful timeout status to publish yet.
11. Let Effect scope interruption cancel the subscription and timeout automatically when the MCP
    request disconnects or is cancelled. Do not detach wait fibers and do not sleep or poll.

This wait reads shell metadata only. It never calls `getThreadDetailById` or
`getThreadDetailSnapshot`. Cursor catch-up uses only a bounded `readEvents` stream and projects
or discards every event before collecting lightweight signals.

#### `thread_read`

Input:

- `threadId`.
- `view`: `final`, `messages`, or `transcript`.
- Optional `includeToolPayloads`, valid only for `transcript` and defaulting to `false`.
- Optional `maxBytes` within the shared bounds.

Implementation:

1. Call `ProjectionSnapshotQuery.getThreadDetailSnapshot` once.
2. Read the active shell once and require target-specific coherence between it and the detail:
   identity, project, active visibility, update time, latest turn, session, and latest user-message
   time must agree. Unrelated environment activity does not invalidate the read. A mismatch returns
   retryable `read_failed` instead of combining output from one target state with status from
   another.
3. If the active-thread query returns none, check active and archived visibility twice and return a
   retryable `read_failed` if the thread moves between them. Otherwise return a specific
   `thread_archived_read_unsupported` error for archived threads. V1 does not widen the projection
   query solely for archived transcript access; callers can only discover archived metadata.
4. For `final`, require a latest turn in `completed` state with a non-null assistant message ID.
   Return that one persisted, non-streaming assistant message. Otherwise return `message: null`
   with the actual current status; never promote a streaming fragment to a final response.
5. For `messages`, return persisted user and assistant rows in stable chronological order. Exclude
   system rows. A currently streaming assistant row may appear once with `streaming: true`; deltas
   are not emitted as separate messages.
6. For `transcript`, merge visible messages, proposed plans, and activities into stable order by
   creation time, then sequence/kind/ID as tie-breakers. Preserve turn IDs and source kinds.
7. With `includeToolPayloads: false`, omit activity payloads while retaining each activity's kind,
   tone, summary, turn ID, sequence, and timestamp. Client projection is not sufficient here because
   clients intentionally retain rendered tool arguments. With it set to `true`, use the full
   activity payload already returned from persistence. Do not reconstruct data that was never
   persisted.

The read result carries a compact bounded status summary containing execution status, foreground
status, blockers, background liveness, and cursor. It omits the full `thread_status` metadata and a
redundant top-level `threadId`; the input already identifies the target. The current detail
projection does not contain every compact status source field, notably blockers and background
liveness. Exact atomic content-and-status projection would require widening that projection, which
is deliberately outside MCP-only v1. The target-specific coherence check above is the strongest
available guard without crossing that boundary.

Apply byte bounding after the view is built:

- Measure UTF-8 JSON bytes, not JavaScript character count.
- Apply the cap to the final encoded MCP `CallToolResult`, including any structured-content and
  JSON-text copies produced by the toolkit. If the generic toolkit handler duplicates the encoded
  success value, either reserve for both copies or register `thread_read` explicitly like
  `preview_snapshot`; verify the actual result size in a handler test.
- Reserve space for the response envelope and truncation metadata.
- Prefer the newest complete items that fit, then return them in chronological order.
- If a single required item exceeds the remaining budget, replace only its large text/payload field
  with a UTF-8-safe preview and mark that field truncated.
- Return `truncated`, `omittedItemCount`, `truncatedFieldCount`, `returnedBytes`, and `maxBytes`.
- Never claim a payload is complete when any part was omitted.
- Do not add pagination or continuation tokens in v1; that belongs to the documented v2 query.

#### `thread_start`

Input:

- Initial `prompt`.
- Optional project ID, title, title seed, workspace path, branch, model selection, runtime mode, and
  interaction mode.

Defaults:

- Project: calling thread's project.
- Workspace: calling thread's effective workspace.
- Model selection, runtime mode, and interaction mode: calling thread's current values.
- Title: explicit title, otherwise title seed, otherwise `New thread`.

Preflight every input before creating anything:

1. Require the calling project and reject any different project ID.
2. Validate the provider/model/options against the cached provider snapshot.
3. Resolve and validate the existing workspace/worktree, then require its real path to equal the
   calling thread's effective workspace real path.
4. Require the selected runtime mode to stay within the credential ceiling.
5. Generate thread, command, and message IDs with `Crypto`; generate one server timestamp with
   `DateTime` and use it consistently.
6. Grant the generated child thread ID to the credential before dispatch.

Then dispatch exactly two existing commands:

1. `thread.create` with the resolved project, model, modes, branch, and worktree.
2. `thread.turn.start` with the initial user message, selected model, title seed, and no bootstrap
   worktree request.

Do not use the WebSocket-only bootstrap object and do not call any Git mutation or setup-script
service. Return after the second dispatch is accepted; provider execution continues asynchronously.

Failure reporting is explicit:

- Creation rejection is a `dispatch_rejected` tool failure. No thread ID or cursor is returned
  because no operation was accepted.
- Creation accepted but turn-start rejected is a `partial_failure` tool failure carrying the new
  thread ID, `acceptedSteps: { threadCreated: true, promptAccepted: false }`, and the creation
  cursor as `lastCursor`.
- Both accepted return `threadCreated: true`, `promptAccepted: true`, the thread ID, and the
  turn-start cursor.

Do not delete a successfully created thread to hide a partial failure. Delete is outside the MCP v1
surface, and retaining the ordinary empty thread lets the caller inspect it and retry with
`thread_send`.

#### `thread_send`

Input:

- `threadId` and `message`.
- Optional model selection, runtime mode, and interaction mode.

Mirror the normal client sequence without importing client runtime:

1. Require the target to be a child controlled by the calling credential.
2. Load the active target shell and reject archived/missing threads.
3. Require the effective runtime mode to stay within the credential ceiling.
4. Validate a requested model selection.
5. When values changed, dispatch `thread.meta.update`, `thread.runtime-mode.set`, and
   `thread.interaction-mode.set` in that order.
6. Dispatch `thread.turn.start` with a new message ID and the selected model/mode values.

Return per-step accepted flags/sequences, `messageAccepted`, and the last cursor. If a settings
command fails, stop before sending. If settings were accepted but the message was rejected, report
the partial result honestly.

A rejection before any step is accepted is `dispatch_rejected`. After at least one settings step
is accepted, a later rejection is `partial_failure` with `acceptedSteps` and `lastCursor`.

Do not inspect whether the provider is currently running. The existing provider command reactor and
adapter own steering versus queued-follow-up behavior. MCP promises command acceptance, not an
invented uniform provider behavior.

#### `thread_interrupt`

Input: `threadId` and optional `turnId`.

Require a credential-owned target, dispatch the existing `thread.turn.interrupt` command, and
return its accepted sequence. Do not stop the provider session.

Reject `threadId === McpInvocationContext.threadId` with `self_interrupt_unsupported`. Interrupting
the turn that is synchronously executing the MCP call can tear down the request before its result is
delivered and leaves acceptance ambiguous. A different parent thread may interrupt it normally.

#### `thread_update`

Use a tagged `action` union so one call maps to one ordinary command and has one unambiguous result:

```text
settle
unsettle
snooze
unsnooze
pin
unpin
rename
regenerate_title
set_model
set_runtime_mode
set_interaction_mode
```

Require a credential-owned target. Map the actions directly to the existing settle/unsettle,
snooze/unsnooze, pin/unpin, metadata, runtime-mode, and interaction-mode commands. Validate model
selection before `set_model`, and reject `set_runtime_mode` above the credential ceiling. Require
an explicit future ISO timestamp for `snooze`. Return only after the command is accepted; title
regeneration itself remains asynchronous.

Do not accept branch/worktree changes through this generic tool. Workspace selection is validated
only at creation time in v1, which prevents MCP from moving an existing provider session between
directories.

### Existing workspace and worktree validation

The validator is read-only and lives inside `ThreadControlService` unless it grows enough to merit a
small MCP-local helper.

1. Resolve both the project workspace root and requested path with `FileSystem.realPath`; require
   the requested path to exist and be a directory.
2. Detect whether the project workspace is a Git repository. For a non-Git project, accept only an
   exact real-path match with the project root and require branch to be omitted/null.
3. For a Git project, inspect both the project root and candidate path through the existing
   `GitVcsDriver.execute` API with fixed read-only arguments; never invoke a shell:
   - `git rev-parse --show-toplevel`
   - `git rev-parse --git-common-dir`
   - `git worktree list --porcelain -z`
   - `git rev-parse --absolute-git-dir`
   - `git symbolic-ref --quiet --short HEAD`
4. Require the requested path to be the returned worktree top-level, not an arbitrary subdirectory.
   This applies to the main project worktree as well as linked worktrees.
5. Resolve the Git common directory for both the project workspace and requested worktree, normalize
   relative output against each command's working directory, and compare their real paths. A match
   proves both paths belong to the same local Git repository/worktree set without relying on remote
   names.
6. Require the candidate's canonical real path to appear in the repository's NUL-delimited
   `git worktree list` output. For linked worktrees, inspect `.git/worktrees/*/gitdir` backlinks and
   require the candidate's absolute Git directory to match the registered administrative directory.
   This rejects recreated directories and forged `.git` pointers even when their common directory
   appears to match.
7. Use the candidate worktree's actual branch as the stored branch. If the caller supplied a branch,
   require an exact match even when the candidate is the project root. Reject detached worktrees
   when a branch was requested; otherwise store `null`.
8. Return only canonical real paths to orchestration.

The allowed Git commands inspect metadata only. The validator must never fetch, initialize, switch,
clean, create, or remove worktrees.

### Typed errors and logging

Define one MCP-local tagged error schema with these stable public codes:

```text
capability_denied
invalid_request
project_not_found
thread_not_found
thread_archived
thread_archived_read_unsupported
provider_unavailable
invalid_model_selection
invalid_workspace
self_interrupt_unsupported
dispatch_rejected
partial_failure
read_failed
internal_error
```

Every error includes `operation`, a plain message, and `retryable`. Partial mutation errors also
include the target thread ID, accepted-step flags, and last cursor. Convert internal typed failures
at the service boundary; do not send Effect causes, stack traces, raw SQL errors, provider secrets,
or bearer credentials to the agent.

Log failures with operation, environment ID, calling thread ID, target thread/project ID, provider
instance, and public error code. Do not log prompts, transcript contents, full tool payloads,
approval answers, or tokens.

### Provider behavior boundary

The toolkit must remain provider-neutral:

- Codex, Claude Agent, Cursor, Grok, and OpenCode all receive the same orchestration commands.
- `ProviderCommandReactor` and `ProviderService` continue to resolve the configured instance and
  adapter.
- Model-switch restrictions, steering support, interruption support, stale approval requests, and
  structured user-input support remain adapter-owned.
- Tool success means orchestration accepted the request. It does not mean the provider finished or
  even successfully began the side effect.
- Provider-side rejection becomes the same session error or activity failure ordinary clients see,
  which `threads_wait`, `thread_status`, and `thread_read` then expose.

Do not add provider switches or capability tables inside MCP. The only MCP-side provider validation
is against the live provider/model snapshot before a mutation begins.

### Implementation phases

#### Phase 1: schemas, capability, and registration

1. Add MCP-local schemas and stable error codes.
2. Add the `thread-control` capability and grant it on issued provider credentials together with
   the provider session's runtime-mode ceiling and an empty child-control set.
3. Declare all tools with correct annotations and register the toolkit beside preview.
4. Add registration/auth tests proving a valid provider credential sees both toolkits and an
   invalid credential still receives 401.

#### Phase 2: read-only discovery and status

1. Implement `thread_context` and `models_list`.
2. Implement provider option validation as a pure helper shared by mutation methods.
3. Implement the pure status mapping.
4. Implement `threads_list` and `thread_status` using shell projections only.
5. Verify that none of these methods calls a detail query.

#### Phase 3: mutations

1. Implement existing-workspace validation.
2. Implement `thread_start` with explicit two-command partial results.
3. Implement `thread_send`, `thread_interrupt`, and `thread_update` as existing command composition.
4. Enforce same-project/workspace child creation, child ownership on every later mutation, and the
   credential runtime-mode ceiling before dispatch.
5. Verify that accepted operations appear through ordinary projection queries and require no MCP
   persistence.

#### Phase 4: event-driven waiting

1. Implement the attach-before-snapshot live queue.
2. Add current-condition short-circuiting, cursor resynchronization, event filtering, coalescing,
   bounded timeout, cancellation, and progress summaries.
3. Prove with tests that streamed assistant deltas do not wake progress or default waits and that
   no detail query is called.

#### Phase 5: bounded reads

1. Implement final, messages, and transcript selection from one detail snapshot.
2. Omit activity payloads unless full payloads were requested.
3. Implement UTF-8 byte bounding and honest truncation metadata.
4. Prove final reads never return an in-progress assistant fragment.

#### Phase 6: integration, documentation, and fork record

1. Run focused MCP service/toolkit tests plus the existing MCP HTTP and credential tests.
2. Run targeted server typecheck, lint, and formatting checks; do not run repo-wide checks.
3. Confirm the final diff has no persistence, contract, client, UI, or provider-adapter changes.
4. Update this specification if implementation had to narrow a contract.
5. Add one `docs/fork/fork-journal.md` entry when runtime behavior lands, recording the upstream
   baseline, MCP-only scope, provider surfaces, and focused verification.

### Focused verification matrix

Use Effect test services, TestClock, queues, and real scoped streams. Do not use sleeps or browser
automation.

| Area              | Required proof                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential scope  | Missing/expired credentials are rejected; credentials carry the session mode ceiling and isolated child grants; no input can select another environment                           |
| Registration      | Existing preview tools remain registered and all ten thread-control tools appear once                                                                                             |
| Context           | Calling thread/project/provider/model/modes/workspace are returned from local state                                                                                               |
| Models            | Multiple instances and provider-specific option descriptors round-trip; unavailable instances are reported and rejected for mutation                                              |
| Listing           | Project, visibility, status, lifecycle, model, and timestamp filters work without detail reads; limits and stable ordering are correct                                            |
| Status            | Every public status, dual blockers, queued grace, background-after-foreground, archived visibility, and settlement separation are covered as pure cases                           |
| Workspaces        | The caller's project root or linked worktree passes; another valid worktree, missing paths, subdirectories, another repository, and branch mismatches fail; no Git mutation runs  |
| Start             | Child control is granted before dispatch; broader project, workspace, and runtime modes fail; create and partial-turn failures remain distinct                                    |
| Send              | Only controlled children accept messages; broader effective runtime modes fail; changed settings still dispatch before the turn                                                   |
| Interrupt         | Controlled-child interruption dispatches normally; arbitrary targets and self-interruption are rejected before dispatch                                                           |
| Update            | Every tagged action maps to the intended existing command for a controlled child; runtime-mode updates obey the ceiling                                                           |
| Wait race safety  | Live subscription attaches before the snapshot; an event during snapshot load is observed; current terminal/blocked states return immediately                                     |
| Wait efficiency   | Timeout uses TestClock; cancellation closes the scoped fiber; token/message deltas do not wake; status reads never hydrate transcript detail                                      |
| Cursor behavior   | Equal cursor waits live; bounded gaps replay only watched transitions; unrelated events catch up silently; ahead/too-stale cursors resynchronize; every response returns a cursor |
| Background work   | Foreground completion with live agents is not `completed`; the end of background liveness wakes a default wait                                                                    |
| Read views        | Final selects only the latest completed assistant message; messages exclude system rows; transcript merges messages/plans/activities stably                                       |
| Read bounds       | ASCII, multi-byte Unicode, one oversized item, many small items, slim payloads, requested full payloads, and truncation metadata all stay within the byte cap                     |
| Provider boundary | At least one mocked case per provider instance proves identical command routing; provider-specific failure is surfaced through ordinary state rather than special MCP logic       |

An optional focused integration test may run the real orchestration engine with mocked provider
services to prove `thread_start -> threads_wait -> thread_read` as one flow. It must wait on domain
events/receipts, not elapsed time, and it must not launch actual provider CLIs or a development
server.

### Expected upstream diff

The completed v1 should have this shape:

- New code almost entirely under `apps/server/src/mcp`.
- Three small edits to existing MCP capability/credential/registration files.
- No changes to the WebSocket command path, HTTP orchestration API, decider, projector, provider
  adapters, persistence, shared contracts, or clients.
- One fork-journal entry and this implementation specification.

If an implementation step requires a schema migration, a new projection, a client change, provider
adapter branching, or refactoring the WebSocket worktree workflow, stop and narrow that operation
instead. That is the guardrail that keeps this fork cheap to update from upstream.

## Acceptance Criteria

- An agent can discover its current T3 context and the models available in its environment.
- Given a project, an agent can list ordinary thread metadata and obtain thread IDs without reading
  transcripts.
- An agent can start a new thread with an initial prompt, selected model options, permission mode,
  interaction mode, and an existing workspace or worktree.
- The start result provides the thread ID and monitoring cursor immediately after acceptance.
- An agent can send follow-ups, interrupt work, perform the supported non-destructive updates, and
  answer pending approval or user-input requests.
- An agent can monitor one or many threads through bounded event-driven waits without repeatedly
  loading messages or tool results.
- Monitoring reports terminal and blocked states accurately and does not mistake settlement for
  completion.
- After completion, an agent can retrieve an active thread's final response, visible messages, or a
  bounded full persisted transcript. Archived threads remain metadata-only in v1.
- Threads created and controlled through MCP remain ordinary T3 threads visible and operable in
  existing clients.
- Child thread IDs returned by MCP are sufficient for the parent to continue the workflow; no
  lineage is persisted.
- MCP never creates or manages worktrees in v1.
- V1 introduces no transcript-content search, persistence migration, workflow engine, Settings UI,
  or destructive thread lifecycle tools.
- The implementation remains confined to the existing MCP area; if that boundary blocks an
  operation, the operation is reduced or deferred rather than duplicating upstream-heavy behavior.
- V2 is explicitly responsible for efficient last-N and cursor-paginated transcript reads.
