import { Tool, Toolkit } from "effect/unstable/ai";

import { ThreadControlService } from "../../ThreadControlService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  ModelsListInput,
  ModelsListResult,
  ThreadContextInput,
  ThreadContextResult,
  ThreadControlFailure,
  ThreadInterruptInput,
  ThreadMutationResult,
  ThreadReadInput,
  ThreadReadResult,
  ThreadSendInput,
  ThreadSendResult,
  ThreadStartInput,
  ThreadStartResult,
  ThreadStatusInput,
  ThreadStatusResult,
  ThreadsListInput,
  ThreadsListResult,
  ThreadsWaitInput,
  ThreadsWaitResult,
  ThreadUpdateInput,
} from "./schemas.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ThreadControlService];

const readTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

const agentActionTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, true) as T;

export const ThreadContextTool = readTool(
  Tool.make("thread_context", {
    description:
      "Return the calling provider session's T3 environment, thread, project, workspace, provider, model, runtime mode, interaction mode, and current status.",
    parameters: ThreadContextInput,
    success: ThreadContextResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Get calling thread context"),
);

export const ModelsListTool = readTool(
  Tool.make("models_list", {
    description:
      "List configured provider instances and their currently cached models, including the exact provider-specific option descriptors needed for a valid model selection.",
    parameters: ModelsListInput,
    success: ModelsListResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "List available models"),
);

export const ThreadsListTool = readTool(
  Tool.make("threads_list", {
    description:
      "List lightweight thread metadata in one project with execution and lifecycle filters, without loading messages, activities, tool results, or transcript contents.",
    parameters: ThreadsListInput,
    success: ThreadsListResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "List project threads"),
);

export const ThreadStatusTool = readTool(
  Tool.make("thread_status", {
    description:
      "Read one thread's lightweight execution, blocker, background-liveness, model, workspace, and lifecycle state without loading its transcript.",
    parameters: ThreadStatusInput,
    success: ThreadStatusResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Get thread status"),
);

export const ThreadsWaitTool = readTool(
  Tool.make("threads_wait", {
    description:
      "Wait efficiently for meaningful completion, interruption, error, approval, user-input, background-idle, or optional progress changes across one or more threads.",
    parameters: ThreadsWaitInput,
    success: ThreadsWaitResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Wait for thread changes"),
);

export const ThreadReadTool = readTool(
  Tool.make("thread_read", {
    description:
      "Read a bounded persisted final response, visible conversation, or transcript from one active thread after monitoring reports a useful state transition.",
    parameters: ThreadReadInput,
    success: ThreadReadResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Read thread output"),
);

export const ThreadStartTool = agentActionTool(
  Tool.make("thread_start", {
    description:
      "Create a controlled child thread in the calling thread's project and exact workspace, within the calling provider session's permission ceiling, and submit its initial prompt.",
    parameters: ThreadStartInput,
    success: ThreadStartResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Start a thread"),
);

export const ThreadSendTool = agentActionTool(
  Tool.make("thread_send", {
    description:
      "Send a follow-up to a child created by this provider credential, optionally changing its model or modes without exceeding the credential's permission ceiling.",
    parameters: ThreadSendInput,
    success: ThreadSendResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Send a thread message"),
);

export const ThreadInterruptTool = agentActionTool(
  Tool.make("thread_interrupt", {
    description:
      "Interrupt a controlled child thread's current or specified active turn through T3's ordinary provider behavior without stopping its provider session.",
    parameters: ThreadInterruptInput,
    success: ThreadMutationResult,
    failure: ThreadControlFailure,
    dependencies,
  }).annotate(Tool.Title, "Interrupt a thread"),
);

export const ThreadUpdateTool = Tool.make("thread_update", {
  description:
    "Apply one reversible lifecycle, title, model, runtime-mode, or interaction-mode update to a controlled child without exceeding the credential's permission ceiling.",
  parameters: ThreadUpdateInput,
  success: ThreadMutationResult,
  failure: ThreadControlFailure,
  dependencies,
})
  .annotate(Tool.Title, "Update a thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ThreadControlToolkit = Toolkit.make(
  ThreadContextTool,
  ModelsListTool,
  ThreadsListTool,
  ThreadStatusTool,
  ThreadsWaitTool,
  ThreadReadTool,
  ThreadStartTool,
  ThreadSendTool,
  ThreadInterruptTool,
  ThreadUpdateTool,
);
