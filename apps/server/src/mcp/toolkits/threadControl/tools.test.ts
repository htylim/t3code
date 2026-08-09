import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import {
  THREAD_READ_DEFAULT_MAX_BYTES,
  THREADS_LIST_DEFAULT_LIMIT,
  THREADS_WAIT_DEFAULT_TIMEOUT_MS,
  ThreadControlFailure,
  ThreadControlStatus,
  ThreadControlErrorCode,
  ThreadReadInput,
  ThreadSendResult,
  ThreadsListInput,
  ThreadsWaitInput,
  ThreadUpdateInput,
} from "./schemas.ts";
import { ThreadControlToolkit } from "./tools.ts";

const readTools = new Set([
  "thread_context",
  "models_list",
  "threads_list",
  "thread_status",
  "threads_wait",
  "thread_read",
]);
const agentActionTools = new Set(["thread_start", "thread_send", "thread_interrupt"]);
const decodeErrorCodes = Schema.decodeUnknownEffect(Schema.Array(ThreadControlErrorCode));
const DefaultsInput = Schema.Struct({
  list: ThreadsListInput,
  wait: ThreadsWaitInput,
  read: ThreadReadInput,
});
const decodeDefaultsInput = Schema.decodeUnknownEffect(DefaultsInput);
const decodeThreadsListInput = Schema.decodeUnknownEffect(ThreadsListInput);
const decodeThreadsWaitInput = Schema.decodeUnknownEffect(ThreadsWaitInput);
const decodeThreadReadInput = Schema.decodeUnknownEffect(ThreadReadInput);
const decodeThreadReadInputStrict = Schema.decodeUnknownEffect(ThreadReadInput, {
  onExcessProperty: "error",
});
const decodeThreadControlFailure = Schema.decodeUnknownEffect(ThreadControlFailure);
const decodeThreadControlStatus = Schema.decodeUnknownEffect(ThreadControlStatus);
const decodeThreadSendResult = Schema.decodeUnknownEffect(ThreadSendResult);
const decodeThreadUpdateInputStrict = Schema.decodeUnknownEffect(ThreadUpdateInput, {
  onExcessProperty: "error",
});

const statusFixture = {
  threadId: "thread-1",
  projectId: "project-1",
  title: "Reviewer",
  visibility: "active",
  status: "idle",
  foregroundStatus: "idle",
  blockedOn: [],
  hasPendingApproval: false,
  hasPendingUserInput: false,
  backgroundLiveness: null,
  latestTurnId: null,
  latestTurnRequestedAt: null,
  latestTurnStartedAt: null,
  latestTurnCompletedAt: null,
  sessionStatus: null,
  sessionLastError: null,
  modelSelection: null,
  runtimeMode: "auto",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  settledOverride: null,
  settledAt: null,
  snoozedAt: null,
  snoozedUntil: null,
  snoozed: false,
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-08-08T10:00:00.000Z",
  updatedAt: "2026-08-08T10:00:00.000Z",
  cursor: 0,
} as const;

it("declares the complete thread-control surface with the specified annotations", () => {
  expect(Object.keys(ThreadControlToolkit.tools)).toEqual([
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

  for (const tool of Object.values(ThreadControlToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly anyOf?: ReadonlyArray<{ readonly type?: unknown }>;
    };
    const isObjectSchema =
      schema.type === "object" ||
      (schema.anyOf?.length !== undefined &&
        schema.anyOf.length > 0 &&
        schema.anyOf.every((member) => member.type === "object"));
    expect(isObjectSchema, `${tool.name} must expose only object input variants`).toBe(true);
    expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    if (readTools.has(tool.name)) {
      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true);
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false);
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true);
      expect(Context.get(tool.annotations, Tool.OpenWorld)).toBe(false);
    }
    if (agentActionTools.has(tool.name)) {
      expect(Context.get(tool.annotations, Tool.Readonly)).toBe(false);
      expect(Context.get(tool.annotations, Tool.Destructive)).toBe(true);
      expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(false);
      expect(Context.get(tool.annotations, Tool.OpenWorld)).toBe(true);
    }
  }

  const update = ThreadControlToolkit.tools.thread_update;
  expect(Context.get(update.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(update.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(update.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(update.annotations, Tool.OpenWorld)).toBe(false);
});

it.effect("publishes every stable public error code", () =>
  decodeErrorCodes([
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
    "partial_failure",
    "read_failed",
    "internal_error",
  ]),
);

it.effect("applies the documented schema defaults and rejects oversized limits", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeDefaultsInput({
      list: {},
      wait: { threadIds: ["thread-1"] },
      read: { threadId: "thread-1", view: "final" },
    });
    expect(decoded.list.limit).toBe(THREADS_LIST_DEFAULT_LIMIT);
    expect(decoded.wait.timeoutMs).toBe(THREADS_WAIT_DEFAULT_TIMEOUT_MS);
    expect(decoded.wait.wakeOn).toEqual([
      "completed",
      "interrupted",
      "error",
      "approval",
      "user_input",
      "background_idle",
    ]);
    expect(decoded.wait.progress).toBe(false);
    expect(decoded.read.maxBytes).toBe(THREAD_READ_DEFAULT_MAX_BYTES);

    yield* decodeThreadsListInput({ limit: 201 }).pipe(Effect.flip);
    yield* decodeThreadsWaitInput({
      threadIds: ["thread-1"],
      timeoutMs: 55_001,
    }).pipe(Effect.flip);
    yield* decodeThreadsWaitInput({ threadIds: [] }).pipe(Effect.flip);
    yield* decodeThreadsWaitInput({ threadIds: ["thread-1", "thread-1"] }).pipe(Effect.flip);
    yield* decodeThreadsWaitInput({
      threadIds: Array.from({ length: 33 }, (_, index) => `thread-${index}`),
    }).pipe(Effect.flip);
    const maximumWait = yield* decodeThreadsWaitInput({
      threadIds: Array.from({ length: 32 }, (_, index) => `thread-${index}`),
    });
    expect(maximumWait.threadIds).toHaveLength(32);
    yield* decodeThreadReadInput({
      threadId: "thread-1",
      view: "final",
      maxBytes: 131_073,
    }).pipe(Effect.flip);
    yield* decodeThreadReadInput({
      threadId: "thread-1",
      view: "final",
      maxBytes: 4_095,
    }).pipe(Effect.flip);
    yield* decodeThreadReadInputStrict({
      threadId: "thread-1",
      view: "messages",
      includeToolPayloads: true,
    }).pipe(Effect.flip);
  }),
);

it.effect("requires action-specific thread update payloads", () =>
  Effect.gen(function* () {
    yield* decodeThreadUpdateInputStrict({
      threadId: "thread-1",
      action: "rename",
      title: "New title",
    });
    yield* decodeThreadUpdateInputStrict({
      threadId: "thread-1",
      action: "snooze",
      snoozedUntil: "2026-08-09T10:00:00.000Z",
    });
    yield* decodeThreadUpdateInputStrict({
      threadId: "thread-1",
      action: "set_runtime_mode",
      runtimeMode: "auto",
    });

    yield* decodeThreadUpdateInputStrict({ threadId: "thread-1", action: "rename" }).pipe(
      Effect.flip,
    );
    yield* decodeThreadUpdateInputStrict({
      threadId: "thread-1",
      action: "settle",
      title: "Not valid for settle",
    }).pipe(Effect.flip);
  }),
);

it.effect("requires identifying list metadata and complete send recovery data", () =>
  Effect.gen(function* () {
    yield* decodeThreadControlStatus(statusFixture);
    yield* decodeThreadControlStatus({ ...statusFixture, title: undefined }).pipe(Effect.flip);
    yield* decodeThreadControlStatus({ ...statusFixture, createdAt: undefined }).pipe(Effect.flip);

    yield* decodeThreadSendResult({
      threadId: "thread-1",
      modelUpdateAccepted: true,
      modelUpdateSequence: 10,
      runtimeModeUpdateAccepted: false,
      runtimeModeUpdateSequence: null,
      interactionModeUpdateAccepted: true,
      interactionModeUpdateSequence: 11,
      messageAccepted: true,
      messageSequence: 12,
      cursor: 12,
    });
    yield* decodeThreadSendResult({
      threadId: "thread-1",
      messageAccepted: true,
      cursor: 12,
    }).pipe(Effect.flip);

    yield* decodeThreadControlFailure({
      _tag: "ThreadControlError",
      code: "partial_failure",
      operation: "thread_send",
      message: "The model changed, but the message was rejected.",
      retryable: true,
      targetThreadId: "thread-1",
      acceptedSteps: { modelUpdate: true, message: false },
      lastCursor: 10,
    });
    yield* decodeThreadControlFailure({
      _tag: "ThreadControlError",
      code: "partial_failure",
      operation: "thread_send",
      message: "The model changed, but the message was rejected.",
      retryable: true,
    }).pipe(Effect.flip);
  }),
);
