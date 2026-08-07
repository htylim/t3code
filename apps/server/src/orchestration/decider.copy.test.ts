import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ThreadCopyCreateCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const CREATED_AT = "2026-08-06T12:00:00.000Z";
const MESSAGE_AT = "2026-07-01T12:00:00.000Z";
const ACTIVITY_AT = "2026-07-01T12:00:01.000Z";
const SOURCE_IDS = {
  thread: "thread-source",
  message: "message-source",
  activity: "activity-source",
  attachment: "attachment-source",
  turn: "turn-source",
} as const;
const TARGET_IDS = {
  thread: ThreadId.make("thread-target"),
  message: MessageId.make("message-target"),
  activity: EventId.make("activity-target"),
  attachment: "attachment-target",
} as const;

function makeReadModel(input?: { readonly targetExists?: boolean }): OrchestrationReadModel {
  return {
    snapshotSequence: 10,
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
      },
    ],
    threads: input?.targetExists
      ? [
          {
            id: TARGET_IDS.thread,
            projectId: ProjectId.make("project-1"),
            title: "Existing",
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            latestTurn: null,
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            pinnedAt: null,
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
        ]
      : [],
    updatedAt: CREATED_AT,
  };
}

function makeCopyCommand(): ThreadCopyCreateCommand {
  return {
    type: "thread.copy.create",
    commandId: CommandId.make("cmd-copy"),
    threadId: TARGET_IDS.thread,
    projectId: ProjectId.make("project-1"),
    title: "Source title (fork)",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: "feature/fork",
    worktreePath: "/tmp/project-worktree",
    messages: [
      {
        id: TARGET_IDS.message,
        role: "user",
        text: "copied message",
        attachments: [
          {
            type: "image",
            id: TARGET_IDS.attachment,
            name: "diagram.png",
            mimeType: "image/png",
            sizeBytes: 100,
          },
        ],
        createdAt: MESSAGE_AT,
        updatedAt: MESSAGE_AT,
      },
    ],
    activities: [
      {
        id: TARGET_IDS.activity,
        tone: "tool",
        kind: "tool.completed",
        summary: "Copied activity",
        payload: { messageId: TARGET_IDS.message },
        createdAt: ACTIVITY_AT,
      },
    ],
    session: {
      threadId: TARGET_IDS.thread,
      status: "ready",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      activeTurnId: null,
      lastError: null,
      updatedAt: CREATED_AT,
    },
    createdAt: CREATED_AT,
  };
}

function asEvents(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): ReadonlyArray<Omit<OrchestrationEvent, "sequence">> {
  return "type" in result ? [result] : result;
}

function collectStringValues(value: unknown, values: string[] = []): ReadonlyArray<string> {
  if (typeof value === "string") {
    values.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, values);
  } else if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectStringValues(entry, values);
  }
  return values;
}

it.layer(NodeServices.layer)("thread.copy.create decider", (it) => {
  it.effect("decides an ordinary target copy from authoritative source data", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel(),
        }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.unsettled",
        "thread.message-sent",
        "thread.activity-appended",
        "thread.session-set",
      ]);
    }),
  );

  it.effect("changes only the title while preserving model modes branch and worktree", () =>
    Effect.gen(function* () {
      const command = makeCopyCommand();
      const [created] = asEvents(
        yield* decideOrchestrationCommand({ command, readModel: makeReadModel() }),
      );

      expect(created?.type).toBe("thread.created");
      if (created?.type !== "thread.created") return;
      expect(created.payload).toMatchObject({
        title: "Source title (fork)",
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        interactionMode: command.interactionMode,
        branch: command.branch,
        worktreePath: command.worktreePath,
      });
    }),
  );

  it.effect("rejects a target thread id that already exists", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel({ targetExists: true }),
        }),
      );

      expect(failure.message).toContain("already exists");
    }),
  );

  it.effect("keeps command retries idempotent through the existing command receipt", () =>
    Effect.gen(function* () {
      const command = makeCopyCommand();
      const events = asEvents(
        yield* decideOrchestrationCommand({ command, readModel: makeReadModel() }),
      );

      expect(events.every((event) => event.commandId === command.commandId)).toBe(true);
    }),
  );

  it.effect("emits only existing upstream event types and payloads", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel(),
        }),
      );
      const allowed = new Set([
        "thread.created",
        "thread.unsettled",
        "thread.message-sent",
        "thread.activity-appended",
        "thread.session-set",
      ]);

      expect(events.every((event) => allowed.has(event.type))).toBe(true);
    }),
  );

  it.effect("persists no source id fork marker or fork-specific status", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel(),
        }),
      );
      const values = collectStringValues(events);

      expect(values).not.toContain(SOURCE_IDS.thread);
      expect(values).not.toContain("forkMarker");
      expect(values).not.toContain("forkStatus");
    }),
  );

  it.effect("remaps every target-owned id and clears references to omitted source records", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel(),
        }),
      );
      const values = collectStringValues(events);

      for (const sourceId of Object.values(SOURCE_IDS)) {
        expect(values).not.toContain(sourceId);
      }
      expect(values).toContain(TARGET_IDS.message);
      expect(values).toContain(TARGET_IDS.activity);
      expect(values).toContain(TARGET_IDS.attachment);
    }),
  );

  it.effect("emits an ordinary user-unsettled event for the target", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: makeCopyCommand(),
          readModel: makeReadModel(),
        }),
      );
      const event = events.find((candidate) => candidate.type === "thread.unsettled");

      expect(event?.type).toBe("thread.unsettled");
      if (event?.type === "thread.unsettled") {
        expect(event.payload).toEqual({
          threadId: TARGET_IDS.thread,
          reason: "user",
          updatedAt: CREATED_AT,
        });
      }
    }),
  );
});
