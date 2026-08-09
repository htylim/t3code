import {
  CommandId,
  isProviderAvailable,
  MessageId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
  type ProjectId,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
  ThreadId as ThreadIdValue,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { type McpInvocationScope, runtimeModeIsWithinAuthority } from "./McpInvocationContext.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { validateModelSelection } from "./toolkits/threadControl/providerValidation.ts";
import {
  ThreadControlError,
  ThreadControlPartialFailure,
  ThreadInterruptInput,
  ThreadMutationResult,
  type ModelsListInput,
  type ModelsListResult,
  ThreadReadInput,
  ThreadReadResult,
  ThreadSendInput,
  ThreadSendResult,
  ThreadStartInput,
  ThreadStartResult,
  type ThreadContextResult,
  type ThreadControlOperation,
  type ThreadStatusResult,
  type ThreadsWaitWakeCondition,
  type ThreadsListInput,
  type ThreadsListResult,
  ThreadsWaitInput,
  ThreadsWaitResult,
  THREADS_WAIT_DEFAULT_TIMEOUT_MS,
  THREADS_WAIT_MAX_PROGRESS_SUMMARIES,
  ThreadUpdateInput,
} from "./toolkits/threadControl/schemas.ts";
import { buildThreadReadResult } from "./toolkits/threadControl/output.ts";
import { projectThreadStatus } from "./toolkits/threadControl/status.ts";

type ModelsInput = typeof ModelsListInput.Type;
type ModelsResult = typeof ModelsListResult.Type;
type ContextResult = typeof ThreadContextResult.Type;
type ListInput = typeof ThreadsListInput.Type;
type ListResult = typeof ThreadsListResult.Type;
type StatusResult = typeof ThreadStatusResult.Type;
type WaitInput = typeof ThreadsWaitInput.Type;
type WaitResult = typeof ThreadsWaitResult.Type;
type WaitWakeCondition = typeof ThreadsWaitWakeCondition.Type;
type ReadInput = typeof ThreadReadInput.Type;
type ReadResult = typeof ThreadReadResult.Type;
type StartInput = typeof ThreadStartInput.Type;
type StartResult = typeof ThreadStartResult.Type;
type SendInput = typeof ThreadSendInput.Type;
type SendResult = typeof ThreadSendResult.Type;
type InterruptInput = typeof ThreadInterruptInput.Type;
type UpdateInput = typeof ThreadUpdateInput.Type;
type MutationResult = typeof ThreadMutationResult.Type;

interface ValidatedWorkspace {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly effectivePath: string;
}

type WaitProgress = WaitResult["progress"][number];

const THREADS_WAIT_COALESCE_WINDOW = Duration.millis(50);
const THREADS_WAIT_SIGNAL_BUFFER_CAPACITY = THREADS_WAIT_MAX_PROGRESS_SUMMARIES;
const THREADS_WAIT_MAX_REPLAY_GAP = 1_000;
const THREADS_WAIT_MAX_PROGRESS_KIND_CHARS = 128;
const THREADS_WAIT_MAX_PROGRESS_SUMMARY_CHARS = 512;

const waitStatusConditions = (
  status: StatusResult,
  wakeOn: ReadonlySet<WaitWakeCondition>,
): ReadonlyArray<WaitWakeCondition> => {
  const matches: Array<WaitWakeCondition> = [];
  if (wakeOn.has("completed") && status.status === "completed") matches.push("completed");
  if (wakeOn.has("interrupted") && status.status === "interrupted") matches.push("interrupted");
  if (wakeOn.has("error") && status.status === "error") matches.push("error");
  if (wakeOn.has("approval") && status.hasPendingApproval) matches.push("approval");
  if (wakeOn.has("user_input") && status.hasPendingUserInput) matches.push("user_input");
  return matches;
};

const waitSignalCanChangeCondition = (signal: WaitProgress): boolean =>
  signal.kind === "thread.session-set" ||
  signal.kind === "thread.turn-diff-completed" ||
  signal.kind === "approval.requested" ||
  signal.kind === "user-input.requested" ||
  signal.kind === "runtime.error" ||
  signal.kind === "task.completed";

const isMeaningfulActivityKind = (kind: string, tone: string): boolean =>
  tone === "error" ||
  kind === "approval.requested" ||
  kind === "approval.resolved" ||
  kind === "user-input.requested" ||
  kind === "user-input.resolved" ||
  kind === "runtime.error" ||
  kind.startsWith("provider.") ||
  kind.startsWith("tool.") ||
  kind.startsWith("task.");

const boundWaitProgressText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  let prefix = value.slice(0, maxChars - 1);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
};

const waitProgressFromEvent = (event: OrchestrationEvent): WaitProgress | null => {
  switch (event.type) {
    case "thread.session-set":
      return {
        sequence: event.sequence,
        threadId: event.payload.threadId,
        kind: event.type,
        tone: event.payload.session.status === "error" ? "error" : "info",
        summary: `Session ${event.payload.session.status}`,
        timestamp: event.payload.session.updatedAt,
      };
    case "thread.turn-start-requested":
      return {
        sequence: event.sequence,
        threadId: event.payload.threadId,
        kind: event.type,
        tone: "info",
        summary: "Turn start requested",
        timestamp: event.payload.createdAt,
      };
    case "thread.turn-interrupt-requested":
      return {
        sequence: event.sequence,
        threadId: event.payload.threadId,
        kind: event.type,
        tone: "info",
        summary: "Turn interruption requested",
        timestamp: event.payload.createdAt,
      };
    case "thread.turn-diff-completed":
      return {
        sequence: event.sequence,
        threadId: event.payload.threadId,
        kind: event.type,
        tone: event.payload.status === "error" ? "error" : "info",
        summary: "Turn diff completed",
        timestamp: event.payload.completedAt,
      };
    case "thread.activity-appended": {
      const activity = event.payload.activity;
      if (!isMeaningfulActivityKind(activity.kind, activity.tone)) return null;
      return {
        sequence: event.sequence,
        threadId: event.payload.threadId,
        kind: boundWaitProgressText(activity.kind, THREADS_WAIT_MAX_PROGRESS_KIND_CHARS),
        tone: activity.tone,
        summary: boundWaitProgressText(activity.summary, THREADS_WAIT_MAX_PROGRESS_SUMMARY_CHARS),
        timestamp: activity.createdAt,
      };
    }
    default:
      return null;
  }
};

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const error = (
  operation: ThreadControlOperation,
  code: ConstructorParameters<typeof ThreadControlError>[0]["code"],
  message: string,
  context: {
    readonly invocation?: McpInvocationScope;
    readonly targetThreadId?: ThreadId;
    readonly targetProjectId?: ProjectId;
  } = {},
) =>
  new ThreadControlError({
    code,
    operation,
    message,
    retryable: code === "read_failed",
    ...(context.invocation === undefined
      ? {}
      : {
          environmentId: context.invocation.environmentId,
          callingThreadId: context.invocation.threadId,
          providerSessionId: context.invocation.providerSessionId,
          providerInstanceId: context.invocation.providerInstanceId,
        }),
    ...(context.targetThreadId === undefined ? {} : { targetThreadId: context.targetThreadId }),
    ...(context.targetProjectId === undefined ? {} : { targetProjectId: context.targetProjectId }),
  });

const mapReadError = (operation: ThreadControlOperation, context: Parameters<typeof error>[3]) =>
  Effect.mapError(() =>
    error(operation, "read_failed", "Thread metadata could not be read from local state.", context),
  );

const providerLabel = (provider: ServerProvider): string =>
  provider.displayName?.trim() ||
  provider.driver
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const modelSelectionsEqual = (left: ModelSelection | null, right: ModelSelection | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    (left.options?.length ?? 0) === (right.options?.length ?? 0) &&
    (left.options ?? []).every((option, index) => {
      const rightOption = right.options?.[index];
      return (
        rightOption !== undefined &&
        option.id === rightOption.id &&
        option.value === rightOption.value
      );
    }));

const latestTurnsEqual = (
  left: OrchestrationThreadShell["latestTurn"],
  right: OrchestrationThreadShell["latestTurn"],
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    left.sourceProposedPlan?.threadId === right.sourceProposedPlan?.threadId &&
    left.sourceProposedPlan?.planId === right.sourceProposedPlan?.planId);

const sessionsEqual = (
  left: OrchestrationThreadShell["session"],
  right: OrchestrationThreadShell["session"],
): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.threadId === right.threadId &&
    left.status === right.status &&
    left.providerName === right.providerName &&
    left.providerInstanceId === right.providerInstanceId &&
    left.runtimeMode === right.runtimeMode &&
    left.activeTurnId === right.activeTurnId &&
    left.lastError === right.lastError &&
    left.updatedAt === right.updatedAt);

const latestUserMessageAt = (
  messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }>,
): string | null => {
  let latest: string | null = null;
  for (const message of messages) {
    if (message.role === "user" && (latest === null || message.createdAt > latest)) {
      latest = message.createdAt;
    }
  }
  return latest;
};

const threadReadTargetIsCoherent = (
  detail: OrchestrationThreadDetailSnapshot,
  shell: OrchestrationThreadShell,
): boolean =>
  detail.thread.id === shell.id &&
  detail.thread.projectId === shell.projectId &&
  detail.thread.archivedAt === null &&
  shell.archivedAt === null &&
  detail.thread.updatedAt === shell.updatedAt &&
  latestTurnsEqual(detail.thread.latestTurn, shell.latestTurn) &&
  sessionsEqual(detail.thread.session, shell.session) &&
  latestUserMessageAt(detail.thread.messages) === shell.latestUserMessageAt;

export interface ThreadControlServiceShape {
  readonly threadContext: (
    invocation: McpInvocationScope,
  ) => Effect.Effect<ContextResult, ThreadControlError>;
  readonly modelsList: (input: ModelsInput) => Effect.Effect<ModelsResult>;
  readonly threadsList: (
    invocation: McpInvocationScope,
    input: ListInput,
  ) => Effect.Effect<ListResult, ThreadControlError>;
  readonly threadStatus: (
    invocation: McpInvocationScope,
    threadId: ThreadId,
  ) => Effect.Effect<StatusResult, ThreadControlError>;
  readonly threadsWait: (
    invocation: McpInvocationScope,
    input: WaitInput,
  ) => Effect.Effect<WaitResult, ThreadControlError>;
  readonly threadRead: (
    invocation: McpInvocationScope,
    input: ReadInput,
  ) => Effect.Effect<ReadResult, ThreadControlError>;
  readonly validateModelSelection: (
    selection: ModelSelection,
  ) => Effect.Effect<ReturnType<typeof validateModelSelection>>;
  readonly threadStart: (
    invocation: McpInvocationScope,
    input: StartInput,
  ) => Effect.Effect<StartResult, ThreadControlError | ThreadControlPartialFailure>;
  readonly threadSend: (
    invocation: McpInvocationScope,
    input: SendInput,
  ) => Effect.Effect<SendResult, ThreadControlError | ThreadControlPartialFailure>;
  readonly threadInterrupt: (
    invocation: McpInvocationScope,
    input: InterruptInput,
  ) => Effect.Effect<MutationResult, ThreadControlError>;
  readonly threadUpdate: (
    invocation: McpInvocationScope,
    input: UpdateInput,
  ) => Effect.Effect<MutationResult, ThreadControlError>;
}

export class ThreadControlService extends Context.Service<
  ThreadControlService,
  ThreadControlServiceShape
>()("t3/mcp/ThreadControlService") {}

export const layer = Layer.effect(
  ThreadControlService,
  Effect.gen(function* () {
    const snapshots = yield* ProjectionSnapshotQuery;
    const providers = yield* ProviderRegistry;
    const orchestration = yield* OrchestrationEngineService;
    const mcpSessions = yield* McpSessionRegistry;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitVcsDriver;
    const crypto = yield* Crypto.Crypto;

    const nextUuid = Effect.fn("ThreadControlService.nextUuid")(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
    ) {
      return yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(() =>
          error(operation, "internal_error", "A local operation identifier could not be created.", {
            invocation,
          }),
        ),
      );
    });

    const dispatch = Effect.fn("ThreadControlService.dispatch")(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      command: OrchestrationCommand,
      context: {
        readonly targetThreadId?: ThreadId;
        readonly targetProjectId?: ProjectId;
      },
    ) {
      return yield* orchestration.dispatch(command).pipe(
        Effect.mapError(() =>
          error(operation, "dispatch_rejected", `Orchestration rejected ${operation}.`, {
            invocation,
            ...context,
          }),
        ),
      );
    });

    const readConsistentShellSnapshots = Effect.fn(
      "ThreadControlService.readConsistentShellSnapshots",
    )(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      context: {
        readonly targetThreadId?: ThreadId;
        readonly targetProjectId?: ProjectId;
      },
    ) {
      let [active, archived] = yield* Effect.all(
        [snapshots.getShellSnapshot(), snapshots.getArchivedShellSnapshot()],
        { concurrency: "unbounded" },
      ).pipe(mapReadError(operation, { invocation, ...context }));

      if (active.snapshotSequence === archived.snapshotSequence) {
        return { active, archived };
      }

      if (active.snapshotSequence < archived.snapshotSequence) {
        active = yield* snapshots
          .getShellSnapshot()
          .pipe(mapReadError(operation, { invocation, ...context }));
      } else {
        archived = yield* snapshots
          .getArchivedShellSnapshot()
          .pipe(mapReadError(operation, { invocation, ...context }));
      }

      if (active.snapshotSequence !== archived.snapshotSequence) {
        return yield* error(
          operation,
          "read_failed",
          "Thread visibility changed again while metadata was being read. Retry the request.",
          { invocation, ...context },
        );
      }
      return { active, archived };
    });

    const readCallingThread = Effect.fn("ThreadControlService.readCallingThread")(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
    ) {
      const shell = yield* snapshots
        .getThreadShellById(invocation.threadId)
        .pipe(mapReadError(operation, { invocation, targetThreadId: invocation.threadId }));
      if (Option.isNone(shell)) {
        return yield* error(
          operation,
          "internal_error",
          "The calling provider session no longer has an active thread.",
          { invocation, targetThreadId: invocation.threadId },
        );
      }
      return shell.value;
    });

    const readProject = Effect.fn("ThreadControlService.readProject")(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      projectId: ProjectId,
      callingProject: boolean,
    ) {
      const project = yield* snapshots
        .getProjectShellById(projectId)
        .pipe(mapReadError(operation, { invocation, targetProjectId: projectId }));
      if (Option.isNone(project)) {
        return yield* error(
          operation,
          callingProject ? "internal_error" : "project_not_found",
          callingProject
            ? "The calling thread's project is missing from local state."
            : `Project '${projectId}' was not found in this environment.`,
          { invocation, targetProjectId: projectId },
        );
      }
      return project.value;
    });

    const readActiveThread = Effect.fn("ThreadControlService.readActiveThread")(function* (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      threadId: ThreadId,
    ) {
      const active = yield* snapshots
        .getThreadShellById(threadId)
        .pipe(mapReadError(operation, { invocation, targetThreadId: threadId }));
      if (Option.isSome(active)) {
        return active.value;
      }
      const archived = yield* snapshots
        .getArchivedShellSnapshot()
        .pipe(mapReadError(operation, { invocation, targetThreadId: threadId }));
      if (archived.threads.some((thread) => thread.id === threadId)) {
        return yield* error(
          operation,
          "thread_archived",
          `Thread '${threadId}' is archived and cannot be mutated.`,
          { invocation, targetThreadId: threadId },
        );
      }
      return yield* error(
        operation,
        "thread_not_found",
        `Thread '${threadId}' was not found in this environment.`,
        { invocation, targetThreadId: threadId },
      );
    });

    const requireControlledThread = (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      threadId: ThreadId,
    ): Effect.Effect<void, ThreadControlError> =>
      invocation.controlledThreadIds.has(threadId)
        ? Effect.void
        : error(
            operation,
            "capability_denied",
            `The MCP credential does not control thread '${threadId}'.`,
            { invocation, targetThreadId: threadId },
          );

    const requireRuntimeModeAuthority = (
      operation: ThreadControlOperation,
      invocation: McpInvocationScope,
      runtimeMode: RuntimeMode,
      context: {
        readonly targetThreadId?: ThreadId;
        readonly targetProjectId?: ProjectId;
      },
    ): Effect.Effect<void, ThreadControlError> =>
      runtimeModeIsWithinAuthority(runtimeMode, invocation.maxRuntimeMode)
        ? Effect.void
        : error(
            operation,
            "capability_denied",
            `The MCP credential may grant at most '${invocation.maxRuntimeMode}', not '${runtimeMode}'.`,
            { invocation, ...context },
          );

    const requireValidModelSelection = Effect.fn("ThreadControlService.requireValidModelSelection")(
      function* (
        operation: ThreadControlOperation,
        invocation: McpInvocationScope,
        selection: ModelSelection,
        context: {
          readonly targetThreadId?: ThreadId;
          readonly targetProjectId?: ProjectId;
        },
      ) {
        const result = validateModelSelection(yield* providers.getProviders, selection);
        if (!result.ok) {
          return yield* error(operation, result.code, result.message, { invocation, ...context });
        }
        return selection;
      },
    );

    const gitRead = Effect.fn("ThreadControlService.gitRead")(function* (
      operation: string,
      cwd: string,
      args: ReadonlyArray<string>,
    ) {
      return yield* git.execute({
        operation,
        cwd,
        args,
        allowNonZeroExit: true,
      });
    });

    const validateWorkspace = Effect.fn("ThreadControlService.validateWorkspace")(function* (
      invocation: McpInvocationScope,
      projectRoot: string,
      requestedPath: string,
      requestedBranch: string | undefined,
      projectId: ProjectId,
    ): Effect.fn.Return<ValidatedWorkspace, ThreadControlError> {
      const invalidWorkspace = (message: string) =>
        error("thread_start", "invalid_workspace", message, {
          invocation,
          targetProjectId: projectId,
        });
      const canonicalProjectRoot = yield* fileSystem
        .realPath(projectRoot)
        .pipe(
          Effect.mapError(() => invalidWorkspace("The project's workspace root does not exist.")),
        );
      const canonicalCandidate = yield* fileSystem
        .realPath(requestedPath)
        .pipe(
          Effect.mapError(() => invalidWorkspace("The requested workspace path does not exist.")),
        );
      const candidateStat = yield* fileSystem
        .stat(canonicalCandidate)
        .pipe(
          Effect.mapError(() => invalidWorkspace("The requested workspace path cannot be read.")),
        );
      if (candidateStat.type !== "Directory") {
        return yield* invalidWorkspace("The requested workspace path is not a directory.");
      }

      const projectTop = yield* gitRead(
        "ThreadControlService.workspace.projectTopLevel",
        canonicalProjectRoot,
        ["rev-parse", "--show-toplevel"],
      ).pipe(
        Effect.mapError(() => invalidWorkspace("The project repository metadata cannot be read.")),
      );
      if (projectTop.exitCode !== 0) {
        if (canonicalCandidate !== canonicalProjectRoot) {
          return yield* invalidWorkspace(
            "A non-Git project can use only its exact project workspace root.",
          );
        }
        if (requestedBranch !== undefined) {
          return yield* invalidWorkspace("A non-Git project cannot select a branch.");
        }
        return { branch: null, worktreePath: null, effectivePath: canonicalCandidate };
      }

      const candidateTop = yield* gitRead(
        "ThreadControlService.workspace.candidateTopLevel",
        canonicalCandidate,
        ["rev-parse", "--show-toplevel"],
      ).pipe(
        Effect.mapError(() => invalidWorkspace("The requested Git workspace cannot be inspected.")),
      );
      if (candidateTop.exitCode !== 0) {
        return yield* invalidWorkspace("The requested workspace is not a Git worktree.");
      }
      const canonicalCandidateTop = yield* fileSystem
        .realPath(path.resolve(canonicalCandidate, candidateTop.stdout.trim()))
        .pipe(Effect.mapError(() => invalidWorkspace("The Git worktree root cannot be resolved.")));
      if (canonicalCandidateTop !== canonicalCandidate) {
        return yield* invalidWorkspace(
          "The requested workspace must be the Git worktree root, not a subdirectory.",
        );
      }

      const [projectCommon, candidateCommon] = yield* Effect.all([
        gitRead("ThreadControlService.workspace.projectCommonDir", canonicalProjectRoot, [
          "rev-parse",
          "--git-common-dir",
        ]),
        gitRead("ThreadControlService.workspace.candidateCommonDir", canonicalCandidate, [
          "rev-parse",
          "--git-common-dir",
        ]),
      ]).pipe(
        Effect.mapError(() => invalidWorkspace("The Git common directory cannot be inspected.")),
      );
      if (projectCommon.exitCode !== 0 || candidateCommon.exitCode !== 0) {
        return yield* invalidWorkspace("The Git common directory cannot be inspected.");
      }
      const [canonicalProjectCommon, canonicalCandidateCommon] = yield* Effect.all([
        fileSystem.realPath(path.resolve(canonicalProjectRoot, projectCommon.stdout.trim())),
        fileSystem.realPath(path.resolve(canonicalCandidate, candidateCommon.stdout.trim())),
      ]).pipe(
        Effect.mapError(() => invalidWorkspace("The Git common directory cannot be resolved.")),
      );
      if (canonicalProjectCommon !== canonicalCandidateCommon) {
        return yield* invalidWorkspace(
          "The requested worktree does not belong to the project's Git repository.",
        );
      }

      const registeredWorktrees = yield* gitRead(
        "ThreadControlService.workspace.registeredWorktrees",
        canonicalProjectRoot,
        ["worktree", "list", "--porcelain", "-z"],
      ).pipe(
        Effect.mapError(() =>
          invalidWorkspace("The registered Git worktrees cannot be inspected."),
        ),
      );
      if (registeredWorktrees.exitCode !== 0 || registeredWorktrees.stdoutTruncated) {
        return yield* invalidWorkspace("The registered Git worktrees cannot be inspected.");
      }
      const canonicalRegisteredWorktrees = yield* Effect.forEach(
        registeredWorktrees.stdout
          .split("\0")
          .filter((field) => field.startsWith("worktree "))
          .map((field) => field.slice("worktree ".length)),
        (registeredPath) => fileSystem.realPath(registeredPath).pipe(Effect.option),
      );
      const registeredIndex = canonicalRegisteredWorktrees.findIndex(
        (registeredPath) =>
          Option.isSome(registeredPath) && registeredPath.value === canonicalCandidate,
      );
      if (registeredIndex === -1) {
        return yield* invalidWorkspace("The requested workspace is not a registered Git worktree.");
      }

      let expectedGitDir = canonicalProjectCommon;
      if (registeredIndex !== 0) {
        const worktreeAdminRoot = path.join(canonicalProjectCommon, "worktrees");
        const adminNames = yield* fileSystem
          .readDirectory(worktreeAdminRoot)
          .pipe(
            Effect.mapError(() =>
              invalidWorkspace("The registered Git worktree metadata cannot be inspected."),
            ),
          );
        const adminCandidates = yield* Effect.forEach(adminNames, (adminName) => {
          const adminPath = path.join(worktreeAdminRoot, adminName);
          return Effect.gen(function* () {
            const backlink = yield* fileSystem
              .readFileString(path.join(adminPath, "gitdir"))
              .pipe(Effect.option);
            if (Option.isNone(backlink)) return Option.none<string>();
            const backlinkPath = path.resolve(adminPath, backlink.value.replace(/\r?\n$/, ""));
            if (path.basename(backlinkPath) !== ".git") return Option.none<string>();
            const backlinkRoot = yield* fileSystem
              .realPath(path.dirname(backlinkPath))
              .pipe(Effect.option);
            if (Option.isNone(backlinkRoot) || backlinkRoot.value !== canonicalCandidate) {
              return Option.none<string>();
            }
            return yield* fileSystem.realPath(adminPath).pipe(Effect.option);
          });
        });
        const registeredAdmin = adminCandidates.find(Option.isSome);
        if (registeredAdmin === undefined) {
          return yield* invalidWorkspace(
            "The registered Git worktree metadata does not match the requested workspace.",
          );
        }
        expectedGitDir = registeredAdmin.value;
      }

      const candidateGitDir = yield* gitRead(
        "ThreadControlService.workspace.candidateGitDir",
        canonicalCandidate,
        ["rev-parse", "--absolute-git-dir"],
      ).pipe(
        Effect.mapError(() => invalidWorkspace("The Git worktree metadata cannot be inspected.")),
      );
      if (candidateGitDir.exitCode !== 0 || candidateGitDir.stdoutTruncated) {
        return yield* invalidWorkspace("The Git worktree metadata cannot be inspected.");
      }
      const canonicalCandidateGitDir = yield* fileSystem
        .realPath(candidateGitDir.stdout.replace(/\r?\n$/, ""))
        .pipe(
          Effect.mapError(() => invalidWorkspace("The Git worktree metadata cannot be resolved.")),
        );
      if (canonicalCandidateGitDir !== expectedGitDir) {
        return yield* invalidWorkspace(
          "The requested workspace does not use its registered Git worktree metadata.",
        );
      }

      const candidateBranch = yield* gitRead(
        "ThreadControlService.workspace.candidateBranch",
        canonicalCandidate,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ).pipe(Effect.mapError(() => invalidWorkspace("The Git branch cannot be inspected.")));
      if (candidateBranch.exitCode !== 0 && candidateBranch.exitCode !== 1) {
        return yield* invalidWorkspace("The Git branch cannot be inspected.");
      }
      const actualBranch = candidateBranch.exitCode === 0 ? candidateBranch.stdout.trim() : null;
      if (actualBranch === "") {
        return yield* invalidWorkspace("The Git branch cannot be determined.");
      }
      if (requestedBranch !== undefined && actualBranch !== requestedBranch) {
        return yield* invalidWorkspace(
          actualBranch === null
            ? `The requested worktree is detached and does not have branch '${requestedBranch}'.`
            : `The requested worktree uses branch '${actualBranch}', not '${requestedBranch}'.`,
        );
      }
      return {
        branch: actualBranch,
        worktreePath: canonicalCandidate === canonicalProjectRoot ? null : canonicalCandidate,
        effectivePath: canonicalCandidate,
      };
    });

    const threadContext = Effect.fn("ThreadControlService.threadContext")(function* (
      invocation: McpInvocationScope,
    ) {
      const cursor = yield* snapshots
        .getSnapshotSequence()
        .pipe(mapReadError("thread_context", { invocation }));
      const thread = yield* readCallingThread("thread_context", invocation);
      const project = yield* readProject("thread_context", invocation, thread.projectId, true);
      const now = yield* nowIso;
      return {
        environmentId: invocation.environmentId,
        threadId: thread.id,
        projectId: project.id,
        projectWorkspaceRoot: project.workspaceRoot,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        effectiveWorkspacePath: thread.worktreePath ?? project.workspaceRoot,
        providerInstanceId: invocation.providerInstanceId,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        status: projectThreadStatus(thread, { cursor: cursor.snapshotSequence, now }),
      } satisfies ContextResult;
    });

    const modelsList = Effect.fn("ThreadControlService.modelsList")(function* (input: ModelsInput) {
      const current = yield* providers.getProviders;
      return {
        providers: current
          .filter((provider) => input.includeUnavailable || isProviderAvailable(provider))
          .map((provider) => ({
            instanceId: provider.instanceId,
            driver: provider.driver,
            label: providerLabel(provider),
            available: isProviderAvailable(provider),
            enabled: provider.enabled,
            installed: provider.installed,
            runtimeStatus: provider.status,
            authenticationStatus: provider.auth.status,
            supportsModelChange: provider.requiresNewThreadForModelChange !== true,
            supportsInteractionMode: provider.showInteractionModeToggle ?? true,
            models: provider.models.map((model) => ({
              slug: model.slug,
              label: model.name,
              description: model.shortName ?? model.subProvider ?? null,
              isDefault: model.isDefault ?? false,
              isCustom: model.isCustom,
              isLegacy: model.isLegacy ?? false,
              optionDescriptors: model.capabilities?.optionDescriptors ?? [],
            })),
          })),
      } satisfies ModelsResult;
    });

    const threadsList = Effect.fn("ThreadControlService.threadsList")(function* (
      invocation: McpInvocationScope,
      input: ListInput,
    ) {
      let callingThread: OrchestrationThreadShell | undefined;
      if (input.projectId === undefined) {
        callingThread = yield* readCallingThread("threads_list", invocation);
      }
      const projectId = input.projectId ?? callingThread!.projectId;
      yield* readProject("threads_list", invocation, projectId, input.projectId === undefined);
      let active: OrchestrationShellSnapshot | undefined;
      let archived: OrchestrationShellSnapshot | undefined;
      if (input.visibility === "all") {
        ({ active, archived } = yield* readConsistentShellSnapshots("threads_list", invocation, {
          targetProjectId: projectId,
        }));
      } else if (input.visibility === "active") {
        active = yield* snapshots
          .getShellSnapshot()
          .pipe(mapReadError("threads_list", { invocation, targetProjectId: projectId }));
      } else {
        archived = yield* snapshots
          .getArchivedShellSnapshot()
          .pipe(mapReadError("threads_list", { invocation, targetProjectId: projectId }));
      }
      const cursor = Math.min(
        ...[active?.snapshotSequence, archived?.snapshotSequence].filter(
          (sequence): sequence is number => sequence !== undefined,
        ),
      );
      const now = yield* nowIso;
      const statuses = [...(active?.threads ?? []), ...(archived?.threads ?? [])]
        .filter((thread) => thread.projectId === projectId)
        .map((thread) => projectThreadStatus(thread, { cursor, now }))
        .filter((thread) => input.statuses === undefined || input.statuses.includes(thread.status))
        .filter(
          (thread) =>
            input.providerInstanceId === undefined ||
            thread.modelSelection?.instanceId === input.providerInstanceId,
        )
        .filter(
          (thread) => input.model === undefined || thread.modelSelection?.model === input.model,
        )
        .filter(
          (thread) =>
            input.settled === undefined || (thread.settledOverride === "settled") === input.settled,
        )
        .filter((thread) => input.snoozed === undefined || thread.snoozed === input.snoozed)
        .filter(
          (thread) => input.pinned === undefined || (thread.pinnedAt !== null) === input.pinned,
        )
        .filter(
          (thread) => input.createdAfter === undefined || thread.createdAt >= input.createdAfter,
        )
        .filter(
          (thread) => input.createdBefore === undefined || thread.createdAt < input.createdBefore,
        )
        .filter(
          (thread) => input.updatedAfter === undefined || thread.updatedAt >= input.updatedAfter,
        )
        .filter(
          (thread) => input.updatedBefore === undefined || thread.updatedAt < input.updatedBefore,
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.threadId.localeCompare(right.threadId),
        );
      const threads = statuses.slice(0, input.limit);
      return {
        threads,
        totalMatched: statuses.length,
        returnedCount: threads.length,
        truncated: threads.length < statuses.length,
        cursor,
      } satisfies ListResult;
    });

    const threadStatus = Effect.fn("ThreadControlService.threadStatus")(function* (
      invocation: McpInvocationScope,
      threadId: ThreadId,
    ) {
      const sequence = yield* snapshots
        .getSnapshotSequence()
        .pipe(mapReadError("thread_status", { invocation, targetThreadId: threadId }));
      const active = yield* snapshots
        .getThreadShellById(threadId)
        .pipe(mapReadError("thread_status", { invocation, targetThreadId: threadId }));
      const now = yield* nowIso;
      if (Option.isSome(active)) {
        return projectThreadStatus(active.value, { cursor: sequence.snapshotSequence, now });
      }
      const archived = yield* snapshots
        .getArchivedShellSnapshot()
        .pipe(mapReadError("thread_status", { invocation, targetThreadId: threadId }));
      const archivedThread = archived.threads.find((thread) => thread.id === threadId);
      if (archivedThread !== undefined) {
        return projectThreadStatus(archivedThread, { cursor: sequence.snapshotSequence, now });
      }
      if (archived.snapshotSequence !== sequence.snapshotSequence) {
        const retriedActive = yield* snapshots
          .getThreadShellById(threadId)
          .pipe(mapReadError("thread_status", { invocation, targetThreadId: threadId }));
        if (Option.isSome(retriedActive)) {
          return projectThreadStatus(retriedActive.value, {
            cursor: sequence.snapshotSequence,
            now,
          });
        }
        const retriedArchived = yield* snapshots
          .getArchivedShellSnapshot()
          .pipe(mapReadError("thread_status", { invocation, targetThreadId: threadId }));
        const retriedArchivedThread = retriedArchived.threads.find(
          (thread) => thread.id === threadId,
        );
        if (retriedArchivedThread !== undefined) {
          return projectThreadStatus(retriedArchivedThread, {
            cursor: sequence.snapshotSequence,
            now,
          });
        }
        if (retriedArchived.snapshotSequence !== archived.snapshotSequence) {
          return yield* error(
            "thread_status",
            "read_failed",
            "Thread visibility changed again while metadata was being read. Retry the request.",
            { invocation, targetThreadId: threadId },
          );
        }
      }
      return yield* error(
        "thread_status",
        "thread_not_found",
        `Thread '${threadId}' was not found in this environment.`,
        { invocation, targetThreadId: threadId },
      );
    });

    const readWaitStatuses = Effect.fn("ThreadControlService.readWaitStatuses")(function* (
      invocation: McpInvocationScope,
      threadIds: ReadonlyArray<ThreadId>,
      cursor: number,
    ) {
      const active = yield* Effect.forEach(
        threadIds,
        (threadId) =>
          snapshots
            .getThreadShellById(threadId)
            .pipe(mapReadError("threads_wait", { invocation, targetThreadId: threadId })),
        { concurrency: "unbounded" },
      );
      const missingIds = threadIds.filter((_, index) => Option.isNone(active[index]!));
      const archived =
        missingIds.length === 0
          ? undefined
          : yield* snapshots
              .getArchivedShellSnapshot()
              .pipe(mapReadError("threads_wait", { invocation }));
      const archivedById = new Map(
        (archived?.threads ?? [])
          .filter((thread) => missingIds.includes(thread.id))
          .map((thread) => [thread.id, thread] as const),
      );
      const now = yield* nowIso;
      return yield* Effect.forEach(threadIds, (threadId, index) => {
        const activeThread = active[index]!;
        const shell = Option.isSome(activeThread) ? activeThread.value : archivedById.get(threadId);
        if (shell === undefined) {
          return Effect.fail(
            error(
              "threads_wait",
              "thread_not_found",
              `Thread '${threadId}' was not found in this environment.`,
              { invocation, targetThreadId: threadId },
            ),
          );
        }
        return Effect.succeed(projectThreadStatus(shell, { cursor, now }));
      });
    });

    const threadsWait = Effect.fn("ThreadControlService.threadsWait")(function* (
      invocation: McpInvocationScope,
      input: WaitInput,
    ) {
      const timeoutMs = input.timeoutMs ?? THREADS_WAIT_DEFAULT_TIMEOUT_MS;
      const wakeOn = new Set<WaitWakeCondition>(input.wakeOn);
      let coherentState:
        | {
            readonly cursor: number;
            readonly statuses: ReadonlyArray<StatusResult>;
            readonly matched: WaitResult["matched"];
          }
        | undefined;

      const wait = Effect.scoped(
        Effect.gen(function* () {
          const requestedIds = new Set<ThreadId>(input.threadIds);
          const liveSignals = yield* Queue.sliding<WaitProgress>(
            THREADS_WAIT_SIGNAL_BUFFER_CAPACITY,
          );
          yield* Effect.addFinalizer(() => Queue.shutdown(liveSignals));
          // Domain events can carry streamed text and full activity payloads.
          // Project or discard them before the wait retains anything.
          yield* orchestration.streamDomainEvents.pipe(
            Stream.map((event) => {
              if (
                event.aggregateKind !== "thread" ||
                !requestedIds.has(ThreadIdValue.make(event.aggregateId))
              ) {
                return null;
              }
              return waitProgressFromEvent(event);
            }),
            Stream.filter((signal): signal is WaitProgress => signal !== null),
            Stream.runForEach((signal) => Queue.offer(liveSignals, signal)),
            Effect.forkScoped({ startImmediately: true }),
          );

          // Capture the authoritative head before shell reads. Any later event is
          // already buffered above and cannot be skipped by the returned cursor.
          const initialHead = yield* orchestration.latestSequence;
          let cursor = initialHead;
          let statuses = yield* readWaitStatuses(invocation, input.threadIds, cursor);
          let observedBackgroundLive = new Set<ThreadId>(
            statuses
              .filter((status) => status.backgroundLiveness !== null)
              .map((status) => status.threadId),
          );

          const commitCoherentState = (matched: WaitResult["matched"]) => {
            coherentState = { cursor, statuses, matched };
          };

          const conditionMatches = (
            candidateStatuses: ReadonlyArray<StatusResult>,
            includeBackgroundIdle: boolean,
            eligibleThreadIds?: ReadonlySet<ThreadId>,
          ) =>
            candidateStatuses.flatMap((status) => {
              if (eligibleThreadIds !== undefined && !eligibleThreadIds.has(status.threadId)) {
                return [];
              }
              const conditions = [...waitStatusConditions(status, wakeOn)];
              if (
                includeBackgroundIdle &&
                wakeOn.has("background_idle") &&
                observedBackgroundLive.has(status.threadId) &&
                status.backgroundLiveness === null
              ) {
                conditions.push("background_idle");
              }
              return conditions.length === 0 ? [] : [{ threadId: status.threadId, conditions }];
            });

          const replayGap =
            input.afterSequence === undefined ? 0 : initialHead - input.afterSequence;
          if (
            input.afterSequence !== undefined &&
            (replayGap < 0 || replayGap > THREADS_WAIT_MAX_REPLAY_GAP)
          ) {
            const currentMatches = conditionMatches(statuses, false);
            commitCoherentState(currentMatches);
            return {
              reason: "resynchronized",
              cursor,
              resynchronized: true,
              threads: statuses,
              matched: currentMatches,
              progress: [],
            } satisfies WaitResult;
          }

          if (input.afterSequence === undefined) {
            const currentMatches = conditionMatches(statuses, false);
            commitCoherentState(currentMatches);
            if (currentMatches.length > 0) {
              return {
                reason: "condition",
                cursor,
                resynchronized: false,
                threads: statuses,
                matched: currentMatches,
                progress: [],
              } satisfies WaitResult;
            }
          }

          const replaySignals =
            input.afterSequence === undefined || replayGap === 0
              ? []
              : Array.from(
                  yield* orchestration.readEvents(input.afterSequence, replayGap).pipe(
                    Stream.filter(
                      (event) =>
                        event.sequence <= initialHead &&
                        event.aggregateKind === "thread" &&
                        requestedIds.has(ThreadIdValue.make(event.aggregateId)),
                    ),
                    Stream.map(waitProgressFromEvent),
                    Stream.filter((signal): signal is WaitProgress => signal !== null),
                    Stream.runCollect,
                    mapReadError("threads_wait", { invocation }),
                  ),
                );
          const replayConditionThreadIds = new Set(
            replaySignals.filter(waitSignalCanChangeCondition).map((signal) => signal.threadId),
          );
          const replayMatches = conditionMatches(statuses, true, replayConditionThreadIds);
          commitCoherentState(replayMatches);
          if (replayMatches.length > 0) {
            return {
              reason: "condition",
              cursor,
              resynchronized: false,
              threads: statuses,
              matched: replayMatches,
              progress: [],
            } satisfies WaitResult;
          }
          if (input.progress && replaySignals.length > 0) {
            return {
              reason: "progress",
              cursor,
              resynchronized: false,
              threads: statuses,
              matched: [],
              progress: replaySignals.slice(-THREADS_WAIT_MAX_PROGRESS_SUMMARIES),
            } satisfies WaitResult;
          }

          const awaitWake = Effect.gen(function* () {
            while (true) {
              const first = yield* Queue.take(liveSignals);
              yield* Effect.sleep(THREADS_WAIT_COALESCE_WINDOW);
              const trailingCount = Math.min(
                yield* Queue.size(liveSignals),
                THREADS_WAIT_SIGNAL_BUFFER_CAPACITY,
              );
              const trailing =
                trailingCount === 0 ? [] : yield* Queue.takeBetween(liveSignals, 1, trailingCount);
              const signals = [first, ...trailing].filter((signal) => signal.sequence > cursor);
              if (signals.length === 0) continue;
              const progress = signals.slice(-THREADS_WAIT_MAX_PROGRESS_SUMMARIES);

              const nextCursor = Math.max(cursor, ...signals.map((signal) => signal.sequence));
              const nextStatuses = yield* readWaitStatuses(invocation, input.threadIds, nextCursor);
              // Commit the batch cursor only with the statuses fetched for it. If the
              // read is interrupted by the deadline, the previous pair stays publishable.
              const conditionThreadIds = new Set(
                signals.filter(waitSignalCanChangeCondition).map((signal) => signal.threadId),
              );
              const matched = conditionMatches(nextStatuses, true, conditionThreadIds);
              statuses = nextStatuses;
              cursor = nextCursor;
              observedBackgroundLive = new Set(observedBackgroundLive);
              for (const status of nextStatuses) {
                if (status.backgroundLiveness !== null) {
                  observedBackgroundLive.add(status.threadId);
                }
              }
              commitCoherentState(matched);
              if (matched.length > 0) {
                return {
                  reason: "condition",
                  cursor,
                  resynchronized: false,
                  threads: statuses,
                  matched,
                  progress: [],
                } satisfies WaitResult;
              }
              if (input.progress) {
                return {
                  reason: "progress",
                  cursor,
                  resynchronized: false,
                  threads: statuses,
                  matched: [],
                  progress,
                } satisfies WaitResult;
              }
            }
          });

          return yield* awaitWake;
        }),
      );

      const result = yield* wait.pipe(Effect.timeoutOption(timeoutMs));
      if (Option.isSome(result)) return result.value;
      if (coherentState === undefined) {
        return yield* error(
          "threads_wait",
          "read_failed",
          "Thread status could not be read before the wait timeout expired. Retry the request.",
          { invocation },
        );
      }

      const lastCoherent = coherentState;
      if (lastCoherent.matched.length > 0) {
        return {
          reason: "condition",
          cursor: lastCoherent.cursor,
          resynchronized: false,
          threads: lastCoherent.statuses,
          matched: lastCoherent.matched,
          progress: [],
        } satisfies WaitResult;
      }
      return {
        reason: "timeout",
        cursor: lastCoherent.cursor,
        resynchronized: false,
        threads: lastCoherent.statuses,
        matched: [],
        progress: [],
      } satisfies WaitResult;
    });

    const threadRead = Effect.fn("ThreadControlService.threadRead")(function* (
      invocation: McpInvocationScope,
      input: ReadInput,
    ) {
      const detail = yield* snapshots
        .getThreadDetailSnapshot(input.threadId)
        .pipe(mapReadError("thread_read", { invocation, targetThreadId: input.threadId }));
      if (Option.isNone(detail)) {
        const readVisibility = Effect.gen(function* () {
          const active = yield* snapshots
            .getThreadShellById(input.threadId)
            .pipe(mapReadError("thread_read", { invocation, targetThreadId: input.threadId }));
          const archived = yield* snapshots
            .getArchivedShellSnapshot()
            .pipe(mapReadError("thread_read", { invocation, targetThreadId: input.threadId }));
          return {
            active: Option.isSome(active),
            archived: archived.threads.some((thread) => thread.id === input.threadId),
          };
        });
        const firstVisibility = yield* readVisibility;
        const secondVisibility = yield* readVisibility;
        if (
          firstVisibility.active ||
          secondVisibility.active ||
          firstVisibility.archived !== secondVisibility.archived
        ) {
          return yield* error(
            "thread_read",
            "read_failed",
            "The thread changed visibility while its persisted output was being read. Retry the request.",
            { invocation, targetThreadId: input.threadId },
          );
        }
        if (secondVisibility.archived) {
          return yield* error(
            "thread_read",
            "thread_archived_read_unsupported",
            `Thread '${input.threadId}' is archived; archived transcript reads are not supported in v1.`,
            { invocation, targetThreadId: input.threadId },
          );
        }
        return yield* error(
          "thread_read",
          "thread_not_found",
          `Thread '${input.threadId}' was not found in this environment.`,
          { invocation, targetThreadId: input.threadId },
        );
      }

      const shell = yield* snapshots
        .getThreadShellById(input.threadId)
        .pipe(mapReadError("thread_read", { invocation, targetThreadId: input.threadId }));
      if (Option.isNone(shell) || !threadReadTargetIsCoherent(detail.value, shell.value)) {
        return yield* error(
          "thread_read",
          "read_failed",
          "The thread changed visibility while its persisted output was being read. Retry the request.",
          { invocation, targetThreadId: input.threadId },
        );
      }
      const now = yield* nowIso;
      return buildThreadReadResult(
        detail.value,
        projectThreadStatus(shell.value, { cursor: detail.value.snapshotSequence, now }),
        input,
      );
    });

    const threadStart = Effect.fn("ThreadControlService.threadStart")(function* (
      invocation: McpInvocationScope,
      input: StartInput,
    ) {
      const callingThread = yield* readCallingThread("thread_start", invocation);
      const projectId = input.projectId ?? callingThread.projectId;
      if (projectId !== callingThread.projectId) {
        return yield* error(
          "thread_start",
          "capability_denied",
          "An MCP credential may create child threads only in its calling project.",
          { invocation, targetProjectId: projectId },
        );
      }
      const targetProject = yield* readProject("thread_start", invocation, projectId, true);
      const modelSelection = input.modelSelection ?? callingThread.modelSelection;
      if (modelSelection === null) {
        return yield* error(
          "thread_start",
          "invalid_model_selection",
          "The calling thread has no model selection; choose an available model explicitly.",
          { invocation, targetProjectId: projectId },
        );
      }
      yield* requireValidModelSelection("thread_start", invocation, modelSelection, {
        targetProjectId: projectId,
      });
      const workspacePath =
        input.workspacePath ?? callingThread.worktreePath ?? targetProject.workspaceRoot;
      const workspace = yield* validateWorkspace(
        invocation,
        targetProject.workspaceRoot,
        workspacePath,
        input.branch,
        projectId,
      );
      const runtimeMode = input.runtimeMode ?? callingThread.runtimeMode;
      yield* requireRuntimeModeAuthority("thread_start", invocation, runtimeMode, {
        targetProjectId: projectId,
      });
      const callingWorkspacePath = yield* fileSystem
        .realPath(callingThread.worktreePath ?? targetProject.workspaceRoot)
        .pipe(
          Effect.mapError(() =>
            error(
              "thread_start",
              "invalid_workspace",
              "The calling thread's workspace path no longer exists.",
              { invocation, targetProjectId: projectId },
            ),
          ),
        );
      if (workspace.effectivePath !== callingWorkspacePath) {
        return yield* error(
          "thread_start",
          "capability_denied",
          "An MCP credential may create child threads only in its calling workspace.",
          { invocation, targetProjectId: projectId },
        );
      }
      const interactionMode = input.interactionMode ?? callingThread.interactionMode;
      const title = input.title ?? input.titleSeed ?? "New thread";

      const createdAt = yield* nowIso;
      const threadId = ThreadIdValue.make(yield* nextUuid("thread_start", invocation));
      const createCommandId = CommandId.make(yield* nextUuid("thread_start", invocation));
      const turnCommandId = CommandId.make(yield* nextUuid("thread_start", invocation));
      const messageId = MessageId.make(yield* nextUuid("thread_start", invocation));
      const granted = yield* mcpSessions.grantControlledThread(
        invocation.providerSessionId,
        threadId,
      );
      if (!granted) {
        return yield* error(
          "thread_start",
          "internal_error",
          "The calling MCP credential expired before child control could be granted.",
          { invocation, targetThreadId: threadId, targetProjectId: projectId },
        );
      }
      const createResult = yield* dispatch(
        "thread_start",
        invocation,
        {
          type: "thread.create",
          commandId: createCommandId,
          threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: workspace.branch,
          worktreePath: workspace.worktreePath,
          createdAt,
        },
        { targetThreadId: threadId, targetProjectId: projectId },
      );
      const turnResult = yield* dispatch(
        "thread_start",
        invocation,
        {
          type: "thread.turn.start",
          commandId: turnCommandId,
          threadId,
          message: {
            messageId,
            role: "user",
            text: input.prompt,
            attachments: [],
          },
          modelSelection,
          ...(input.titleSeed === undefined ? {} : { titleSeed: input.titleSeed }),
          runtimeMode,
          interactionMode,
          createdAt,
        },
        { targetThreadId: threadId, targetProjectId: projectId },
      ).pipe(
        Effect.mapError(
          () =>
            new ThreadControlPartialFailure({
              code: "partial_failure",
              operation: "thread_start",
              message:
                "The thread was created, but orchestration rejected its initial prompt. The empty thread remains available for retry.",
              retryable: true,
              environmentId: invocation.environmentId,
              callingThreadId: invocation.threadId,
              providerSessionId: invocation.providerSessionId,
              providerInstanceId: invocation.providerInstanceId,
              targetThreadId: threadId,
              targetProjectId: projectId,
              acceptedSteps: { threadCreated: true, promptAccepted: false },
              lastCursor: createResult.sequence,
            }),
        ),
      );
      return {
        threadCreated: true,
        promptAccepted: true,
        threadId,
        cursor: turnResult.sequence,
      } satisfies StartResult;
    });

    const threadSend = Effect.fn("ThreadControlService.threadSend")(function* (
      invocation: McpInvocationScope,
      input: SendInput,
    ) {
      yield* requireControlledThread("thread_send", invocation, input.threadId);
      const thread = yield* readActiveThread("thread_send", invocation, input.threadId);
      if (input.modelSelection !== undefined) {
        yield* requireValidModelSelection("thread_send", invocation, input.modelSelection, {
          targetThreadId: input.threadId,
          targetProjectId: thread.projectId,
        });
      }
      const modelSelection = input.modelSelection ?? thread.modelSelection;
      const runtimeMode = input.runtimeMode ?? thread.runtimeMode;
      yield* requireRuntimeModeAuthority("thread_send", invocation, runtimeMode, {
        targetThreadId: input.threadId,
        targetProjectId: thread.projectId,
      });
      const interactionMode = input.interactionMode ?? thread.interactionMode;
      const modelChanged =
        input.modelSelection !== undefined &&
        !modelSelectionsEqual(input.modelSelection, thread.modelSelection);
      const runtimeModeChanged =
        input.runtimeMode !== undefined && input.runtimeMode !== thread.runtimeMode;
      const interactionModeChanged =
        input.interactionMode !== undefined && input.interactionMode !== thread.interactionMode;
      const createdAt = yield* nowIso;
      const modelCommandId = modelChanged
        ? CommandId.make(yield* nextUuid("thread_send", invocation))
        : undefined;
      const runtimeModeCommandId = runtimeModeChanged
        ? CommandId.make(yield* nextUuid("thread_send", invocation))
        : undefined;
      const interactionModeCommandId = interactionModeChanged
        ? CommandId.make(yield* nextUuid("thread_send", invocation))
        : undefined;
      const turnCommandId = CommandId.make(yield* nextUuid("thread_send", invocation));
      const messageId = MessageId.make(yield* nextUuid("thread_send", invocation));
      const acceptedSteps: Record<string, boolean> = {
        modelUpdate: false,
        runtimeModeUpdate: false,
        interactionModeUpdate: false,
        message: false,
      };
      let lastCursor: number | undefined;
      const partialDispatch = Effect.fn("ThreadControlService.threadSend.partialDispatch")(
        function* (command: OrchestrationCommand, step: keyof typeof acceptedSteps) {
          const result = yield* dispatch("thread_send", invocation, command, {
            targetThreadId: input.threadId,
            targetProjectId: thread.projectId,
          }).pipe(
            Effect.mapError((dispatchError) => {
              if (lastCursor === undefined) {
                return dispatchError;
              }
              return new ThreadControlPartialFailure({
                code: "partial_failure",
                operation: "thread_send",
                message: `Thread settings were partially accepted before '${step}' was rejected.`,
                retryable: true,
                environmentId: invocation.environmentId,
                callingThreadId: invocation.threadId,
                providerSessionId: invocation.providerSessionId,
                providerInstanceId: invocation.providerInstanceId,
                targetThreadId: input.threadId,
                targetProjectId: thread.projectId,
                acceptedSteps,
                lastCursor,
              });
            }),
          );
          acceptedSteps[step] = true;
          lastCursor = result.sequence;
          return result.sequence;
        },
      );

      const modelUpdateSequence = modelChanged
        ? yield* partialDispatch(
            {
              type: "thread.meta.update",
              commandId: modelCommandId!,
              threadId: input.threadId,
              modelSelection: input.modelSelection!,
            },
            "modelUpdate",
          )
        : null;
      const runtimeModeUpdateSequence = runtimeModeChanged
        ? yield* partialDispatch(
            {
              type: "thread.runtime-mode.set",
              commandId: runtimeModeCommandId!,
              threadId: input.threadId,
              runtimeMode,
              createdAt,
            },
            "runtimeModeUpdate",
          )
        : null;
      const interactionModeUpdateSequence = interactionModeChanged
        ? yield* partialDispatch(
            {
              type: "thread.interaction-mode.set",
              commandId: interactionModeCommandId!,
              threadId: input.threadId,
              interactionMode,
              createdAt,
            },
            "interactionModeUpdate",
          )
        : null;
      const messageSequence = yield* partialDispatch(
        {
          type: "thread.turn.start",
          commandId: turnCommandId,
          threadId: input.threadId,
          message: {
            messageId,
            role: "user",
            text: input.message,
            attachments: [],
          },
          ...(modelSelection === null ? {} : { modelSelection }),
          runtimeMode,
          interactionMode,
          createdAt,
        },
        "message",
      );

      return {
        threadId: input.threadId,
        modelUpdateAccepted: modelChanged,
        modelUpdateSequence,
        runtimeModeUpdateAccepted: runtimeModeChanged,
        runtimeModeUpdateSequence,
        interactionModeUpdateAccepted: interactionModeChanged,
        interactionModeUpdateSequence,
        messageAccepted: true,
        messageSequence,
        cursor: messageSequence,
      } satisfies SendResult;
    });

    const threadInterrupt = Effect.fn("ThreadControlService.threadInterrupt")(function* (
      invocation: McpInvocationScope,
      input: InterruptInput,
    ) {
      if (input.threadId === invocation.threadId) {
        return yield* error(
          "thread_interrupt",
          "self_interrupt_unsupported",
          "A provider session cannot interrupt the thread executing its own MCP request.",
          { invocation, targetThreadId: input.threadId },
        );
      }
      yield* requireControlledThread("thread_interrupt", invocation, input.threadId);
      const thread = yield* readActiveThread("thread_interrupt", invocation, input.threadId);
      const createdAt = yield* nowIso;
      const result = yield* dispatch(
        "thread_interrupt",
        invocation,
        {
          type: "thread.turn.interrupt",
          commandId: CommandId.make(yield* nextUuid("thread_interrupt", invocation)),
          threadId: input.threadId,
          ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
          createdAt,
        },
        { targetThreadId: input.threadId, targetProjectId: thread.projectId },
      );
      return { threadId: input.threadId, accepted: true, cursor: result.sequence };
    });

    const threadUpdate = Effect.fn("ThreadControlService.threadUpdate")(function* (
      invocation: McpInvocationScope,
      input: UpdateInput,
    ) {
      yield* requireControlledThread("thread_update", invocation, input.threadId);
      const thread = yield* readActiveThread("thread_update", invocation, input.threadId);
      if (input.action === "set_runtime_mode") {
        yield* requireRuntimeModeAuthority("thread_update", invocation, input.runtimeMode, {
          targetThreadId: input.threadId,
          targetProjectId: thread.projectId,
        });
      }
      if (input.action === "set_model") {
        yield* requireValidModelSelection("thread_update", invocation, input.modelSelection, {
          targetThreadId: input.threadId,
          targetProjectId: thread.projectId,
        });
      }
      if (input.action === "snooze") {
        const wakeTime = DateTime.make(input.snoozedUntil);
        const now = yield* DateTime.now;
        if (
          Option.isNone(wakeTime) ||
          DateTime.toEpochMillis(wakeTime.value) <= DateTime.toEpochMillis(now)
        ) {
          return yield* error(
            "thread_update",
            "invalid_request",
            "Snooze requires an explicit future ISO timestamp.",
            { invocation, targetThreadId: input.threadId, targetProjectId: thread.projectId },
          );
        }
      }
      const createdAt = yield* nowIso;
      const commandId = CommandId.make(yield* nextUuid("thread_update", invocation));
      const command: OrchestrationCommand = (() => {
        switch (input.action) {
          case "settle":
            return { type: "thread.settle", commandId, threadId: input.threadId };
          case "unsettle":
            return {
              type: "thread.unsettle",
              commandId,
              threadId: input.threadId,
              reason: "user",
            };
          case "snooze":
            return {
              type: "thread.snooze",
              commandId,
              threadId: input.threadId,
              snoozedUntil: input.snoozedUntil,
            };
          case "unsnooze":
            return {
              type: "thread.unsnooze",
              commandId,
              threadId: input.threadId,
              reason: "user",
            };
          case "pin":
            return { type: "thread.pin", commandId, threadId: input.threadId };
          case "unpin":
            return { type: "thread.unpin", commandId, threadId: input.threadId };
          case "rename":
            return {
              type: "thread.meta.update",
              commandId,
              threadId: input.threadId,
              title: input.title,
            };
          case "regenerate_title":
            return {
              type: "thread.meta.update",
              commandId,
              threadId: input.threadId,
              regenerateTitle: true,
            };
          case "set_model":
            return {
              type: "thread.meta.update",
              commandId,
              threadId: input.threadId,
              modelSelection: input.modelSelection,
            };
          case "set_runtime_mode":
            return {
              type: "thread.runtime-mode.set",
              commandId,
              threadId: input.threadId,
              runtimeMode: input.runtimeMode,
              createdAt,
            };
          case "set_interaction_mode":
            return {
              type: "thread.interaction-mode.set",
              commandId,
              threadId: input.threadId,
              interactionMode: input.interactionMode,
              createdAt,
            };
        }
      })();
      const result = yield* dispatch("thread_update", invocation, command, {
        targetThreadId: input.threadId,
        targetProjectId: thread.projectId,
      });
      return { threadId: input.threadId, accepted: true, cursor: result.sequence };
    });

    return ThreadControlService.of({
      threadContext,
      modelsList,
      threadsList,
      threadStatus,
      threadsWait,
      threadRead,
      threadStart,
      threadSend,
      threadInterrupt,
      threadUpdate,
      validateModelSelection: (selection) =>
        providers.getProviders.pipe(
          Effect.map((current) => validateModelSelection(current, selection)),
        ),
    });
  }),
);
