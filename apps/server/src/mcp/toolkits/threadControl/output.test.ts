import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import { projectThreadStatus } from "./status.ts";
import {
  buildThreadReadResult,
  makeThreadReadCallToolResult,
  threadReadCallToolResultBytes,
} from "./output.ts";

const base = "2026-08-09T00:00:00.000Z";
const threadId = ThreadId.make("thread-read");
const projectId = ProjectId.make("project-read");
const providerInstanceId = ProviderInstanceId.make("codex");
const turnId = TurnId.make("turn-read");

const shell = (overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell => ({
  id: threadId,
  projectId,
  title: "Read thread",
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
  runtimeMode: "auto",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: {
    turnId,
    state: "completed",
    requestedAt: base,
    startedAt: base,
    completedAt: base,
    assistantMessageId: MessageId.make("assistant-final"),
  },
  createdAt: base,
  updatedAt: base,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  pinnedAt: null,
  titleRegeneration: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  backgroundLiveness: null,
  ...overrides,
});

const message = (
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  createdAt: string,
  streaming = false,
): OrchestrationMessage => ({
  id: MessageId.make(id),
  role,
  text,
  turnId,
  streaming,
  createdAt,
  updatedAt: createdAt,
});

const snapshot = (
  messages: ReadonlyArray<OrchestrationMessage>,
  overrides: Partial<OrchestrationThreadDetailSnapshot["thread"]> = {},
): OrchestrationThreadDetailSnapshot => ({
  snapshotSequence: 42,
  thread: {
    id: threadId,
    projectId,
    title: "Read thread",
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: shell().latestTurn,
    createdAt: base,
    updatedAt: base,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    titleRegeneration: null,
    deletedAt: null,
    messages,
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  },
});

const status = projectThreadStatus(shell(), { cursor: 42, now: base });

it("keeps an empty final envelope bounded when full status metadata is oversized", () => {
  const oversizedStatus = {
    ...status,
    title: "title".repeat(5_000),
    sessionLastError: "error".repeat(5_000),
    modelSelection: {
      instanceId: providerInstanceId,
      model: "model".repeat(5_000),
      options: [{ id: "option".repeat(5_000), value: "value".repeat(5_000) }],
    },
    branch: "branch".repeat(5_000),
    worktreePath: "path".repeat(5_000),
  };
  const result = buildThreadReadResult(snapshot([]), oversizedStatus, {
    threadId,
    view: "final",
    maxBytes: 4_096,
  });

  expect(result).toMatchObject({
    view: "final",
    message: null,
    status: {
      status: "completed",
      foregroundStatus: "completed",
      blockedOn: [],
      backgroundLiveness: null,
      cursor: 42,
    },
    truncated: false,
    omittedItemCount: 0,
    truncatedFieldCount: 0,
  });
  expect(result).not.toHaveProperty("threadId");
  expect(result.status).not.toHaveProperty("title");
  expect(result.returnedBytes).toBe(threadReadCallToolResultBytes(result));
  expect(result.returnedBytes).toBeLessThanOrEqual(result.maxBytes);
});

it("returns only the persisted non-streaming message named by the latest completed turn", () => {
  const detail = snapshot([
    message("assistant-other", "assistant", "older", "2026-08-09T00:00:01.000Z"),
    message("assistant-final", "assistant", "final", "2026-08-09T00:00:02.000Z"),
    message("assistant-streaming", "assistant", "in progress", "2026-08-09T00:00:03.000Z", true),
  ]);
  const result = buildThreadReadResult(detail, status, {
    threadId,
    view: "final",
    maxBytes: 65_536,
  });

  expect(result.view).toBe("final");
  if (result.view !== "final") throw new Error("unexpected view");
  expect(result.message).toMatchObject({ id: "assistant-final", text: "final", streaming: false });

  const running = buildThreadReadResult(
    snapshot(detail.thread.messages, {
      latestTurn: { ...detail.thread.latestTurn!, state: "running", completedAt: null },
    }),
    projectThreadStatus(
      shell({ latestTurn: { ...shell().latestTurn!, state: "running", completedAt: null } }),
      {
        cursor: 42,
        now: base,
      },
    ),
    { threadId, view: "final", maxBytes: 65_536 },
  );
  expect(running.view === "final" ? running.message : undefined).toBeNull();

  const streamingFinal = buildThreadReadResult(
    snapshot([message("assistant-final", "assistant", "still streaming", base, true)]),
    status,
    { threadId, view: "final", maxBytes: 65_536 },
  );
  expect(streamingFinal.view === "final" ? streamingFinal.message : undefined).toBeNull();
});

it("returns visible messages in stable order with at most one streaming assistant row", () => {
  const result = buildThreadReadResult(
    snapshot([
      message("assistant-stream-b", "assistant", "latest stream", "2026-08-09T00:00:04.000Z", true),
      message("system", "system", "hidden", "2026-08-09T00:00:00.000Z"),
      message("assistant", "assistant", "answer", "2026-08-09T00:00:02.000Z"),
      message("user", "user", "question", "2026-08-09T00:00:01.000Z"),
      message("assistant-stream-a", "assistant", "old stream", "2026-08-09T00:00:03.000Z", true),
    ]),
    status,
    { threadId, view: "messages", maxBytes: 65_536 },
  );

  expect(result.view).toBe("messages");
  if (result.view !== "messages") throw new Error("unexpected view");
  expect(result.messages.map(({ id }) => id)).toEqual(["user", "assistant", "assistant-stream-b"]);
  expect(result.messages.filter(({ streaming }) => streaming)).toHaveLength(1);
});

it("omits provider tool payloads by default and preserves them only when requested", () => {
  const codexPayload = {
    itemType: "mcp_tool_call",
    data: {
      item: {
        tool: "search",
        arguments: { query: "private Codex input" },
        appContext: { authorization: "private Codex context" },
        result: { content: "private Codex result" },
      },
    },
  };
  const claudePayload = {
    itemType: "mcp_tool_call",
    data: {
      toolName: "mcp__github__fetch_pr",
      input: { pr: 42, token: "private Claude input" },
      result: { content: "private Claude result" },
    },
  };
  const openCodePayload = {
    itemType: "mcp_tool_call",
    data: {
      toolName: "mcp_repository_search",
      input: { query: "private OpenCode input" },
      result: { output: "private OpenCode result" },
      raw: { fullProviderPayload: "private OpenCode payload" },
    },
  };
  const detail = snapshot([message("message", "user", "question", "2026-08-09T00:00:01.000Z")], {
    proposedPlans: [
      {
        id: "plan",
        turnId,
        planMarkdown: "Plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-08-09T00:00:02.000Z",
        updatedAt: "2026-08-09T00:00:02.000Z",
      },
    ],
    activities: [
      {
        id: EventId.make("activity-codex"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Codex tool completed",
        payload: codexPayload,
        turnId,
        sequence: 8,
        createdAt: "2026-08-09T00:00:03.000Z",
      },
      {
        id: EventId.make("activity-claude"),
        tone: "tool",
        kind: "tool.completed",
        summary: "Claude tool completed",
        payload: claudePayload,
        turnId,
        sequence: 9,
        createdAt: "2026-08-09T00:00:03.000Z",
      },
      {
        id: EventId.make("activity-opencode"),
        tone: "tool",
        kind: "tool.completed",
        summary: "OpenCode tool completed",
        payload: openCodePayload,
        turnId,
        sequence: 10,
        createdAt: "2026-08-09T00:00:03.000Z",
      },
    ],
  });
  const slim = buildThreadReadResult(detail, status, {
    threadId,
    view: "transcript",
    includeToolPayloads: false,
    maxBytes: 131_072,
  });
  const full = buildThreadReadResult(detail, status, {
    threadId,
    view: "transcript",
    includeToolPayloads: true,
    maxBytes: 131_072,
  });

  if (slim.view !== "transcript" || full.view !== "transcript") {
    throw new Error("unexpected view");
  }
  expect(slim.items.map(({ source, id }) => `${source}:${id}`)).toEqual([
    "message:message",
    "plan:plan",
    "activity:activity-codex",
    "activity:activity-claude",
    "activity:activity-opencode",
  ]);
  expect(slim.items.filter(({ source }) => source === "activity")).toEqual([
    expect.objectContaining({
      id: "activity-codex",
      kind: "tool.completed",
      tone: "tool",
      text: "Codex tool completed",
      turnId,
      sequence: 8,
    }),
    expect.objectContaining({
      id: "activity-claude",
      kind: "tool.completed",
      tone: "tool",
      text: "Claude tool completed",
      turnId,
      sequence: 9,
    }),
    expect.objectContaining({
      id: "activity-opencode",
      kind: "tool.completed",
      tone: "tool",
      text: "OpenCode tool completed",
      turnId,
      sequence: 10,
    }),
  ]);
  for (const item of slim.items.filter(({ source }) => source === "activity")) {
    expect(item).not.toHaveProperty("payload");
  }
  expect(full.items.find(({ id }) => id === "activity-codex")?.payload).toEqual(codexPayload);
  expect(full.items.find(({ id }) => id === "activity-claude")?.payload).toEqual(claudePayload);
  expect(full.items.find(({ id }) => id === "activity-opencode")?.payload).toEqual(openCodePayload);
});

it("bounds ASCII and multibyte oversized fields on the actual duplicated MCP result", () => {
  for (const text of ["a".repeat(30_000), "🧪漢字".repeat(8_000)]) {
    const result = buildThreadReadResult(
      snapshot([message("assistant-final", "assistant", text, base)]),
      status,
      { threadId, view: "final", maxBytes: 4_096 },
    );
    const callToolResult = makeThreadReadCallToolResult(result);
    expect(result.view).toBe("final");
    if (result.view !== "final") throw new Error("unexpected view");
    expect(result.truncated).toBe(true);
    expect(result.truncatedFieldCount).toBe(1);
    expect(result.message?.truncatedFields).toEqual(["text"]);
    expect(result.message?.text).not.toContain("�");
    expect(result.returnedBytes).toBe(threadReadCallToolResultBytes(result));
    expect(Buffer.byteLength(JSON.stringify(callToolResult), "utf8")).toBeLessThanOrEqual(4_096);
    expect(
      JSON.parse(
        callToolResult.content[0]!.type === "text" ? callToolResult.content[0]!.text : "null",
      ),
    ).toEqual(callToolResult.structuredContent);
  }
});

it("previews an oversized persisted payload without claiming it is complete", () => {
  const result = buildThreadReadResult(
    snapshot([], {
      activities: [
        {
          id: EventId.make("large-payload"),
          tone: "tool",
          kind: "tool.completed",
          summary: "Large result",
          payload: { result: "🧪".repeat(20_000) },
          turnId,
          sequence: 1,
          createdAt: base,
        },
      ],
    }),
    status,
    {
      threadId,
      view: "transcript",
      includeToolPayloads: true,
      maxBytes: 4_096,
    },
  );

  if (result.view !== "transcript") throw new Error("unexpected view");
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.truncatedFields).toEqual(["payload"]);
  expect(result.truncated).toBe(true);
  expect(result.omittedItemCount).toBe(0);
  expect(result.truncatedFieldCount).toBe(1);
  expect(String(result.items[0]?.payload)).not.toContain("�");
  expect(result.returnedBytes).toBe(threadReadCallToolResultBytes(result));
  expect(result.returnedBytes).toBeLessThanOrEqual(result.maxBytes);
});

it("keeps the newest complete small items and returns them chronologically", () => {
  const messages = Array.from({ length: 60 }, (_, index) =>
    message(
      `message-${String(index).padStart(2, "0")}`,
      index % 2 === 0 ? "user" : "assistant",
      `item ${index} ${"x".repeat(120)}`,
      `2026-08-09T00:00:${String(index).padStart(2, "0")}.000Z`,
    ),
  );
  const result = buildThreadReadResult(snapshot(messages), status, {
    threadId,
    view: "messages",
    maxBytes: 8_192,
  });

  if (result.view !== "messages") throw new Error("unexpected view");
  expect(result.truncated).toBe(true);
  expect(result.omittedItemCount).toBeGreaterThan(0);
  expect(result.messages.at(-1)?.id).toBe("message-59");
  expect(result.messages.map(({ createdAt }) => createdAt).sort()).toEqual(
    result.messages.map(({ createdAt }) => createdAt),
  );
  expect(result.returnedBytes).toBe(threadReadCallToolResultBytes(result));
  expect(result.returnedBytes).toBeLessThanOrEqual(result.maxBytes);
});

it("omits an item with oversized immutable metadata and keeps older complete items", () => {
  const oversizedId = MessageId.make(`newest-${"x".repeat(10_000)}`);
  const result = buildThreadReadResult(
    snapshot([
      message("older", "user", "Older complete item", "2026-08-09T00:00:01.000Z"),
      message(
        oversizedId,
        "assistant",
        "Newest item whose text cannot compensate for its ID",
        "2026-08-09T00:00:02.000Z",
      ),
    ]),
    status,
    { threadId, view: "messages", maxBytes: 4_096 },
  );

  if (result.view !== "messages") throw new Error("unexpected view");
  expect(result.messages.map(({ id }) => id)).toEqual(["older"]);
  expect(result.messages[0]?.truncatedFields).toEqual([]);
  expect(result).toMatchObject({
    truncated: true,
    omittedItemCount: 1,
    truncatedFieldCount: 0,
  });
  expect(result.returnedBytes).toBe(threadReadCallToolResultBytes(result));
  expect(result.returnedBytes).toBeLessThanOrEqual(result.maxBytes);
});
