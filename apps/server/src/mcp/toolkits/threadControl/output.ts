import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";
import { McpSchema } from "effect/unstable/ai";

import { THREAD_READ_DEFAULT_MAX_BYTES } from "./schemas.ts";
import type {
  ThreadControlStatus,
  ThreadReadInput,
  ThreadReadItem,
  ThreadReadResult,
  ThreadReadStatus,
} from "./schemas.ts";

type ReadInput = typeof ThreadReadInput.Type;
type ReadItem = typeof ThreadReadItem.Type;
type ReadResult = typeof ThreadReadResult.Type;
type ReadStatus = typeof ThreadControlStatus.Type;
type ReadStatusSummary = typeof ThreadReadStatus.Type;
type TruncatedField = ReadItem["truncatedFields"][number];

const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

export const makeThreadReadCallToolResult = (result: unknown) =>
  new McpSchema.CallToolResult({
    isError: false,
    structuredContent: result,
    content: [{ type: "text", text: JSON.stringify(result) }],
  });

export const threadReadCallToolResultBytes = (result: unknown): number =>
  utf8Bytes(makeThreadReadCallToolResult(result));

const withReturnedBytes = <T extends ReadResult>(result: T): T => {
  let returnedBytes = result.returnedBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = threadReadCallToolResultBytes({ ...result, returnedBytes });
    if (next === returnedBytes) return { ...result, returnedBytes };
    returnedBytes = next;
  }
  return { ...result, returnedBytes };
};

const compareItems = (left: ReadItem, right: ReadItem): number =>
  left.createdAt.localeCompare(right.createdAt) ||
  (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
  left.kind.localeCompare(right.kind) ||
  left.id.localeCompare(right.id);

const summarizeStatus = (status: ReadStatus): ReadStatusSummary => ({
  status: status.status,
  foregroundStatus: status.foregroundStatus,
  blockedOn: status.blockedOn,
  backgroundLiveness: status.backgroundLiveness,
  cursor: status.cursor,
});

const messageItem = (message: OrchestrationMessage): ReadItem => ({
  id: message.id,
  source: "message",
  kind: "message",
  role: message.role,
  tone: null,
  turnId: message.turnId,
  sequence: null,
  createdAt: message.createdAt,
  streaming: message.streaming,
  text: message.text,
  ...(message.attachments === undefined ? {} : { payload: { attachments: message.attachments } }),
  truncatedFields: [],
});

const planItem = (plan: OrchestrationProposedPlan): ReadItem => ({
  id: plan.id,
  source: "plan",
  kind: "proposed_plan",
  role: null,
  tone: null,
  turnId: plan.turnId,
  sequence: null,
  createdAt: plan.createdAt,
  streaming: false,
  text: plan.planMarkdown,
  payload: {
    implementedAt: plan.implementedAt,
    implementationThreadId: plan.implementationThreadId,
    updatedAt: plan.updatedAt,
  },
  truncatedFields: [],
});

const activityItem = (
  activity: OrchestrationThreadActivity,
  includeToolPayloads: boolean,
): ReadItem => ({
  id: activity.id,
  source: "activity",
  kind: activity.kind,
  role: null,
  tone: activity.tone,
  turnId: activity.turnId,
  sequence: activity.sequence ?? null,
  createdAt: activity.createdAt,
  streaming: false,
  text: activity.summary,
  ...(includeToolPayloads ? { payload: activity.payload } : {}),
  truncatedFields: [],
});

const visibleMessages = (
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyArray<OrchestrationMessage> => {
  const visible = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  const latestStreamingAssistant = visible.findLast(
    (message) => message.role === "assistant" && message.streaming,
  );
  return visible.filter(
    (message) =>
      !message.streaming ||
      (message.role === "assistant" && message.id === latestStreamingAssistant?.id),
  );
};

const itemsOf = (result: ReadResult): ReadonlyArray<ReadItem> => {
  switch (result.view) {
    case "final":
      return result.message === null ? [] : [result.message];
    case "messages":
      return result.messages;
    case "transcript":
      return result.items;
  }
};

const withItems = <T extends ReadResult>(result: T, items: ReadonlyArray<ReadItem>): T => {
  switch (result.view) {
    case "final":
      return { ...result, message: items[0] ?? null } as T;
    case "messages":
      return { ...result, messages: items } as T;
    case "transcript":
      return { ...result, items } as T;
  }
};

const safeUtf8Prefix = (value: string, byteLength: number): string => {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= byteLength) return value;
  let end = Math.max(0, byteLength);
  while (end > 0 && (encoded[end] ?? 0) >= 0x80 && (encoded[end] ?? 0) < 0xc0) end -= 1;
  return encoded.subarray(0, end).toString("utf8");
};

const fieldText = (item: ReadItem, field: TruncatedField): string | undefined => {
  if (field === "text") return item.text;
  if (!("payload" in item)) return undefined;
  return JSON.stringify(item.payload);
};

const replaceField = (item: ReadItem, field: TruncatedField, preview: string): ReadItem => ({
  ...item,
  [field]: preview,
  truncatedFields: item.truncatedFields.includes(field)
    ? item.truncatedFields
    : [...item.truncatedFields, field],
});

const previewBoundaryItem = <T extends ReadResult>(
  result: T,
  item: ReadItem,
  selectedNewer: ReadonlyArray<ReadItem>,
  omittedItemCount: number,
): T | undefined => {
  let previewed = item;
  const fields = (["text", "payload"] as const)
    .map((field) => ({ field, text: fieldText(item, field) }))
    .filter((entry): entry is { field: TruncatedField; text: string } => entry.text !== undefined)
    .sort(
      (left, right) => Buffer.byteLength(right.text, "utf8") - Buffer.byteLength(left.text, "utf8"),
    );

  for (const { field, text } of fields) {
    let low = 0;
    let high = Buffer.byteLength(text, "utf8");
    let best: T | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const prefix = safeUtf8Prefix(text, middle);
      const preview = prefix.length === text.length ? prefix : `${prefix}…`;
      const candidateItem = replaceField(previewed, field, preview);
      const candidate = withReturnedBytes(
        withItems(
          {
            ...result,
            truncated: true,
            omittedItemCount,
            truncatedFieldCount: candidateItem.truncatedFields.length,
          },
          [candidateItem, ...selectedNewer].sort(compareItems),
        ),
      );
      if (candidate.returnedBytes <= result.maxBytes) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best !== undefined) return best;
    previewed = replaceField(previewed, field, "");
  }
  return undefined;
};

export function boundThreadReadResult<T extends ReadResult>(result: T): T {
  const complete = withReturnedBytes(result);
  if (complete.returnedBytes <= result.maxBytes) return complete;

  const allItems = itemsOf(result);
  const selected: ReadItem[] = [];
  let omittedUnfitItemCount = 0;
  for (let index = allItems.length - 1; index >= 0; index -= 1) {
    const item = allItems[index]!;
    const omittedItemCount = omittedUnfitItemCount + index;
    const candidateItems = [item, ...selected].sort(compareItems);
    const candidate = withReturnedBytes(
      withItems(
        {
          ...result,
          truncated: true,
          omittedItemCount,
          truncatedFieldCount: 0,
        },
        candidateItems,
      ),
    );
    if (candidate.returnedBytes <= result.maxBytes) {
      selected.unshift(item);
      continue;
    }
    const previewed = previewBoundaryItem(result, item, selected, omittedItemCount);
    if (previewed !== undefined) return previewed;
    omittedUnfitItemCount += 1;
  }

  return withReturnedBytes(
    withItems(
      {
        ...result,
        truncated: omittedUnfitItemCount > 0,
        omittedItemCount: omittedUnfitItemCount,
        truncatedFieldCount: 0,
      },
      selected,
    ),
  );
}

export function buildThreadReadResult(
  snapshot: OrchestrationThreadDetailSnapshot,
  status: ReadStatus,
  input: ReadInput,
): ReadResult {
  const thread = snapshot.thread;
  const messages = visibleMessages(thread.messages);
  const metadata = {
    status: summarizeStatus(status),
    truncated: false,
    omittedItemCount: 0,
    truncatedFieldCount: 0,
    returnedBytes: 0,
    maxBytes: input.maxBytes ?? THREAD_READ_DEFAULT_MAX_BYTES,
  } as const;

  if (input.view === "final") {
    const finalMessage =
      thread.latestTurn?.state === "completed" && thread.latestTurn.assistantMessageId !== null
        ? messages.find(
            (message) =>
              message.id === thread.latestTurn!.assistantMessageId &&
              message.role === "assistant" &&
              !message.streaming,
          )
        : undefined;
    return boundThreadReadResult({
      ...metadata,
      view: "final",
      message: finalMessage === undefined ? null : messageItem(finalMessage),
    });
  }

  if (input.view === "messages") {
    return boundThreadReadResult({
      ...metadata,
      view: "messages",
      messages: messages.map(messageItem),
    });
  }

  return boundThreadReadResult({
    ...metadata,
    view: "transcript",
    items: [
      ...messages.map(messageItem),
      ...thread.proposedPlans.map(planItem),
      ...thread.activities.map((activity) =>
        activityItem(activity, input.includeToolPayloads === true),
      ),
    ].sort(compareItems),
  });
}
