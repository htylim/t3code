import {
  EnvironmentId,
  IsoDateTime,
  ModelSelection,
  NonNegativeInt,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const THREADS_LIST_DEFAULT_LIMIT = 50;
export const THREADS_LIST_MAX_LIMIT = 200;
export const THREADS_WAIT_DEFAULT_TIMEOUT_MS = 30_000;
export const THREADS_WAIT_MAX_TIMEOUT_MS = 55_000;
export const THREADS_WAIT_MAX_THREAD_IDS = 32;
export const THREADS_WAIT_MAX_PROGRESS_SUMMARIES = 32;
export const THREAD_READ_DEFAULT_MAX_BYTES = 65_536;
export const THREAD_READ_MAX_BYTES = 131_072;
export const THREAD_READ_MIN_MAX_BYTES = 4_096;

const described = <S extends Schema.Top>(schema: S, description: string): S =>
  schema.annotate({ description }) as S;

const NonEmptyText = TrimmedNonEmptyString;
const Prompt = NonEmptyText.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS));
const Cursor = NonNegativeInt;
const ListLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: THREADS_LIST_MAX_LIMIT }),
);
const WaitTimeout = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: THREADS_WAIT_MAX_TIMEOUT_MS }),
);
const ReadMaxBytes = Schema.Int.check(
  Schema.isBetween({
    minimum: THREAD_READ_MIN_MAX_BYTES,
    maximum: THREAD_READ_MAX_BYTES,
  }),
);

const uniqueThreadIds = Schema.makeFilter(
  (threadIds: ReadonlyArray<ThreadId>) =>
    new Set(threadIds).size === threadIds.length || "threadIds must contain unique IDs.",
);

export const ThreadControlOperation = Schema.Literals([
  "thread_context",
  "models_list",
  "threads_list",
  "thread_status",
  "threads_wait",
  "thread_read",
  "thread_start",
  "thread_send",
  "thread_interrupt",
  "thread_update",
]);
export type ThreadControlOperation = typeof ThreadControlOperation.Type;

const THREAD_CONTROL_NON_PARTIAL_ERROR_CODES = [
  "capability_denied",
  "invalid_request",
  "project_not_found",
  "thread_not_found",
  "thread_archived",
  "thread_archived_read_unsupported",
  "provider_unavailable",
  "invalid_model_selection",
  "invalid_workspace",
  "self_interrupt_unsupported",
  "dispatch_rejected",
  "read_failed",
  "internal_error",
] as const;

export const ThreadControlErrorCode = Schema.Literals([
  ...THREAD_CONTROL_NON_PARTIAL_ERROR_CODES,
  "partial_failure",
]);
export type ThreadControlErrorCode = typeof ThreadControlErrorCode.Type;

const ThreadControlNonPartialErrorCode = Schema.Literals(THREAD_CONTROL_NON_PARTIAL_ERROR_CODES);

const ThreadControlErrorContextFields = {
  operation: ThreadControlOperation,
  message: Schema.String,
  retryable: Schema.Boolean,
  environmentId: Schema.optionalKey(EnvironmentId),
  callingThreadId: Schema.optionalKey(ThreadId),
  providerSessionId: Schema.optionalKey(Schema.String),
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  targetThreadId: Schema.optionalKey(ThreadId),
  targetProjectId: Schema.optionalKey(ProjectId),
} as const;

export class ThreadControlError extends Schema.TaggedErrorClass<ThreadControlError>()(
  "ThreadControlError",
  {
    code: ThreadControlNonPartialErrorCode,
    ...ThreadControlErrorContextFields,
  },
) {}

export class ThreadControlPartialFailure extends Schema.TaggedErrorClass<ThreadControlPartialFailure>()(
  "ThreadControlError",
  {
    code: Schema.Literal("partial_failure"),
    ...ThreadControlErrorContextFields,
    targetThreadId: ThreadId,
    acceptedSteps: Schema.Record(Schema.String, Schema.Boolean),
    lastCursor: Cursor,
  },
) {}

export const ThreadControlFailure = Schema.Union([ThreadControlError, ThreadControlPartialFailure]);

export const ThreadExecutionStatus = Schema.Literals([
  "idle",
  "queued",
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_user_input",
  "completed",
  "interrupted",
  "error",
]);

export const ThreadForegroundStatus = Schema.Literals([
  "idle",
  "queued",
  "starting",
  "running",
  "completed",
  "interrupted",
  "error",
]);

export const ThreadControlStatus = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: NonEmptyText,
  visibility: Schema.Literals(["active", "archived"]),
  status: ThreadExecutionStatus,
  foregroundStatus: ThreadForegroundStatus,
  blockedOn: Schema.Array(Schema.Literals(["approval", "user_input"])),
  hasPendingApproval: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  backgroundLiveness: Schema.NullOr(Schema.Literals(["working", "monitoring"])),
  latestTurnId: Schema.NullOr(TurnId),
  latestTurnRequestedAt: Schema.NullOr(IsoDateTime),
  latestTurnStartedAt: Schema.NullOr(IsoDateTime),
  latestTurnCompletedAt: Schema.NullOr(IsoDateTime),
  sessionStatus: Schema.NullOr(Schema.String),
  sessionLastError: Schema.NullOr(Schema.String),
  modelSelection: Schema.NullOr(ModelSelection),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "unsettled"])),
  settledAt: Schema.NullOr(IsoDateTime),
  snoozedAt: Schema.NullOr(IsoDateTime),
  snoozedUntil: Schema.NullOr(IsoDateTime),
  snoozed: Schema.Boolean,
  pinnedAt: Schema.NullOr(IsoDateTime),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  cursor: Cursor,
});

export const ThreadContextInput = Schema.Record(Schema.String, Schema.Never);

export const ThreadContextResult = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  projectId: ProjectId,
  projectWorkspaceRoot: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  effectiveWorkspacePath: Schema.String,
  providerInstanceId: ProviderInstanceId,
  modelSelection: Schema.NullOr(ModelSelection),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  status: ThreadControlStatus,
});

export const ModelsListInput = Schema.Struct({
  includeUnavailable: Schema.optional(
    described(
      Schema.Boolean,
      "Include configured provider instances that are currently unavailable.",
    ),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});

const ThreadControlModel = Schema.Struct({
  slug: Schema.String,
  label: Schema.String,
  description: Schema.NullOr(Schema.String),
  isDefault: Schema.Boolean,
  isCustom: Schema.Boolean,
  isLegacy: Schema.Boolean,
  optionDescriptors: Schema.Array(ProviderOptionDescriptor),
});

const ThreadControlProvider = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  label: Schema.String,
  available: Schema.Boolean,
  enabled: Schema.Boolean,
  installed: Schema.Boolean,
  runtimeStatus: Schema.String,
  authenticationStatus: Schema.String,
  supportsModelChange: Schema.Boolean,
  supportsInteractionMode: Schema.Boolean,
  models: Schema.Array(ThreadControlModel),
});

export const ModelsListResult = Schema.Struct({
  providers: Schema.Array(ThreadControlProvider),
});

export const ThreadsListVisibility = Schema.Literals(["active", "archived", "all"]);

export const ThreadsListInput = Schema.Struct({
  projectId: Schema.optional(
    described(ProjectId, "Project to list; defaults to the calling thread's project."),
  ),
  visibility: Schema.optional(
    described(ThreadsListVisibility, "Whether to list active threads, archived threads, or both."),
  ).pipe(Schema.withDecodingDefault(Effect.succeed("active" as const))),
  statuses: Schema.optional(
    described(
      Schema.Array(ThreadExecutionStatus),
      "Only return threads with one of these execution statuses.",
    ),
  ),
  providerInstanceId: Schema.optional(
    described(ProviderInstanceId, "Only return threads using this configured provider instance."),
  ),
  model: Schema.optional(described(NonEmptyText, "Only return threads using this model slug.")),
  settled: Schema.optional(
    described(Schema.Boolean, "Filter by explicit settled lifecycle state."),
  ),
  snoozed: Schema.optional(described(Schema.Boolean, "Filter by effective snooze state.")),
  pinned: Schema.optional(described(Schema.Boolean, "Filter by pinned state.")),
  createdAfter: Schema.optional(
    described(IsoDateTime, "Only return threads created at or after this ISO timestamp."),
  ),
  createdBefore: Schema.optional(
    described(IsoDateTime, "Only return threads created before this ISO timestamp."),
  ),
  updatedAfter: Schema.optional(
    described(IsoDateTime, "Only return threads updated at or after this ISO timestamp."),
  ),
  updatedBefore: Schema.optional(
    described(IsoDateTime, "Only return threads updated before this ISO timestamp."),
  ),
  limit: Schema.optional(
    described(ListLimit, "Maximum threads to return; defaults to 50 and cannot exceed 200."),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(THREADS_LIST_DEFAULT_LIMIT))),
});

export const ThreadsListResult = Schema.Struct({
  threads: Schema.Array(ThreadControlStatus),
  totalMatched: NonNegativeInt,
  returnedCount: NonNegativeInt,
  truncated: Schema.Boolean,
  cursor: Cursor,
});

export const ThreadStatusInput = Schema.Struct({
  threadId: described(ThreadId, "Thread whose current lightweight state should be returned."),
});

export const ThreadStatusResult = ThreadControlStatus;

export const ThreadsWaitWakeCondition = Schema.Literals([
  "completed",
  "interrupted",
  "error",
  "approval",
  "user_input",
  "background_idle",
]);

export const ThreadsWaitInput = Schema.Struct({
  threadIds: described(
    Schema.Array(ThreadId)
      .check(Schema.isMinLength(1), Schema.isMaxLength(THREADS_WAIT_MAX_THREAD_IDS))
      .check(uniqueThreadIds),
    "One to 32 unique thread IDs to monitor.",
  ),
  afterSequence: Schema.optional(
    described(
      Cursor,
      "Global orchestration cursor returned by a prior start, status, or wait call. When provided, only relevant watched-thread transitions after this cursor match; bounded missed history is caught up automatically.",
    ),
  ),
  timeoutMs: Schema.optional(
    described(
      WaitTimeout,
      "Bounded wait duration in milliseconds; defaults to 30000 and cannot exceed 55000.",
    ),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(THREADS_WAIT_DEFAULT_TIMEOUT_MS))),
  wakeOn: Schema.optional(
    described(Schema.Array(ThreadsWaitWakeCondition), "Conditions that should end the wait."),
  ).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([
        "completed",
        "interrupted",
        "error",
        "approval",
        "user_input",
        "background_idle",
      ] as const),
    ),
  ),
  progress: Schema.optional(
    described(Schema.Boolean, "Also return for meaningful lightweight progress events."),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});

const ThreadsWaitMatch = Schema.Struct({
  threadId: ThreadId,
  conditions: Schema.Array(ThreadsWaitWakeCondition),
});

const ThreadsWaitProgress = Schema.Struct({
  sequence: Cursor,
  threadId: ThreadId,
  kind: Schema.String,
  tone: Schema.NullOr(Schema.String),
  summary: Schema.String,
  timestamp: IsoDateTime,
});

export const ThreadsWaitResult = Schema.Struct({
  reason: Schema.Literals(["condition", "progress", "timeout", "resynchronized"]),
  cursor: Cursor,
  resynchronized: Schema.Boolean,
  threads: Schema.Array(ThreadControlStatus),
  matched: Schema.Array(ThreadsWaitMatch),
  progress: Schema.Array(ThreadsWaitProgress).check(
    Schema.isMaxLength(THREADS_WAIT_MAX_PROGRESS_SUMMARIES),
  ),
});

const ThreadReadInputBase = {
  threadId: described(ThreadId, "Thread whose persisted output should be read."),
  maxBytes: Schema.optional(
    described(
      ReadMaxBytes,
      "Maximum encoded result size in UTF-8 bytes; defaults to 65536 and must be between 4096 and 131072.",
    ),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(THREAD_READ_DEFAULT_MAX_BYTES))),
} as const;

export const ThreadReadInput = Schema.Union([
  Schema.Struct({
    ...ThreadReadInputBase,
    view: Schema.Literal("final"),
  }),
  Schema.Struct({
    ...ThreadReadInputBase,
    view: Schema.Literal("messages"),
  }),
  Schema.Struct({
    ...ThreadReadInputBase,
    view: Schema.Literal("transcript"),
    includeToolPayloads: Schema.optional(
      described(
        Schema.Boolean,
        "Include full stored tool arguments and results for transcript reads.",
      ),
    ).pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  }),
]);

export const ThreadReadItem = Schema.Struct({
  id: Schema.String,
  source: Schema.Literals(["message", "plan", "activity"]),
  kind: Schema.String,
  role: Schema.NullOr(Schema.String),
  tone: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.NullOr(NonNegativeInt),
  createdAt: IsoDateTime,
  streaming: Schema.Boolean,
  text: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
  truncatedFields: Schema.Array(Schema.Literals(["text", "payload"])),
});

export const ThreadReadStatus = Schema.Struct({
  status: ThreadExecutionStatus,
  foregroundStatus: ThreadForegroundStatus,
  blockedOn: Schema.Array(Schema.Literals(["approval", "user_input"])).check(Schema.isMaxLength(2)),
  backgroundLiveness: Schema.NullOr(Schema.Literals(["working", "monitoring"])),
  cursor: Cursor,
});

const ThreadReadResultBase = {
  status: ThreadReadStatus,
  truncated: Schema.Boolean,
  omittedItemCount: NonNegativeInt,
  truncatedFieldCount: NonNegativeInt,
  returnedBytes: NonNegativeInt,
  maxBytes: NonNegativeInt,
} as const;

export const ThreadReadResult = Schema.Union([
  Schema.Struct({
    ...ThreadReadResultBase,
    view: Schema.Literal("final"),
    message: Schema.NullOr(ThreadReadItem),
  }),
  Schema.Struct({
    ...ThreadReadResultBase,
    view: Schema.Literal("messages"),
    messages: Schema.Array(ThreadReadItem),
  }),
  Schema.Struct({
    ...ThreadReadResultBase,
    view: Schema.Literal("transcript"),
    items: Schema.Array(ThreadReadItem),
  }),
]);

export const ThreadStartInput = Schema.Struct({
  prompt: described(Prompt, "Initial user prompt for the new thread."),
  projectId: Schema.optional(
    described(ProjectId, "Calling thread's project ID; other projects are rejected."),
  ),
  title: Schema.optional(described(NonEmptyText, "Explicit title for the new thread.")),
  titleSeed: Schema.optional(
    described(NonEmptyText, "Title-generation seed used when title is omitted."),
  ),
  workspacePath: Schema.optional(
    described(NonEmptyText, "Calling thread's exact existing workspace or Git worktree path."),
  ),
  branch: Schema.optional(
    described(NonEmptyText, "Expected branch of the existing workspace or worktree."),
  ),
  modelSelection: Schema.optional(
    described(ModelSelection, "Provider instance, model, and provider-specific options."),
  ),
  runtimeMode: Schema.optional(
    described(RuntimeMode, "Runtime mode within the calling credential's permission ceiling."),
  ),
  interactionMode: Schema.optional(
    described(ProviderInteractionMode, "Default or plan interaction mode."),
  ),
});

export const ThreadStartResult = Schema.Struct({
  threadCreated: Schema.Boolean,
  promptAccepted: Schema.Boolean,
  threadId: Schema.optionalKey(ThreadId),
  cursor: Schema.optionalKey(Cursor),
});

export const ThreadSendInput = Schema.Struct({
  threadId: described(ThreadId, "Existing active thread that should receive the user message."),
  message: described(Prompt, "User message to send."),
  modelSelection: Schema.optional(
    described(ModelSelection, "Optional model selection for this follow-up."),
  ),
  runtimeMode: Schema.optional(
    described(RuntimeMode, "Optional runtime mode within the calling credential's ceiling."),
  ),
  interactionMode: Schema.optional(
    described(ProviderInteractionMode, "Optional interaction mode for this follow-up."),
  ),
});

export const ThreadSendResult = Schema.Struct({
  threadId: ThreadId,
  modelUpdateAccepted: Schema.Boolean,
  modelUpdateSequence: Schema.NullOr(Cursor),
  runtimeModeUpdateAccepted: Schema.Boolean,
  runtimeModeUpdateSequence: Schema.NullOr(Cursor),
  interactionModeUpdateAccepted: Schema.Boolean,
  interactionModeUpdateSequence: Schema.NullOr(Cursor),
  messageAccepted: Schema.Boolean,
  messageSequence: Schema.NullOr(Cursor),
  cursor: Cursor,
});

export const ThreadInterruptInput = Schema.Struct({
  threadId: described(ThreadId, "Active thread whose current turn should be interrupted."),
  turnId: Schema.optional(described(TurnId, "Specific active turn to interrupt when known.")),
});

export const ThreadMutationResult = Schema.Struct({
  threadId: ThreadId,
  accepted: Schema.Boolean,
  cursor: Cursor,
});

export const ThreadUpdateAction = Schema.Literals([
  "settle",
  "unsettle",
  "snooze",
  "unsnooze",
  "pin",
  "unpin",
  "rename",
  "regenerate_title",
  "set_model",
  "set_runtime_mode",
  "set_interaction_mode",
]);

const ThreadUpdateBaseFields = {
  threadId: described(ThreadId, "Thread to update."),
} as const;

const ThreadUpdateWithoutPayload = <const Action extends typeof ThreadUpdateAction.Type>(
  action: Action,
) =>
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal(action),
  });

export const ThreadUpdateInput = Schema.Union([
  ThreadUpdateWithoutPayload("settle"),
  ThreadUpdateWithoutPayload("unsettle"),
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal("snooze"),
    snoozedUntil: described(IsoDateTime, "Future ISO timestamp required by snooze."),
  }),
  ThreadUpdateWithoutPayload("unsnooze"),
  ThreadUpdateWithoutPayload("pin"),
  ThreadUpdateWithoutPayload("unpin"),
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal("rename"),
    title: described(NonEmptyText, "New title for the thread."),
  }),
  ThreadUpdateWithoutPayload("regenerate_title"),
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal("set_model"),
    modelSelection: described(ModelSelection, "New model selection for the thread."),
  }),
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal("set_runtime_mode"),
    runtimeMode: described(
      RuntimeMode,
      "New runtime mode within the calling credential's ceiling.",
    ),
  }),
  Schema.Struct({
    ...ThreadUpdateBaseFields,
    action: Schema.Literal("set_interaction_mode"),
    interactionMode: described(
      ProviderInteractionMode,
      "New default or plan interaction mode for the thread.",
    ),
  }),
]);
