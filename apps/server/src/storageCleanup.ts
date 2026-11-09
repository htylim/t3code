import {
  GitCommandError,
  ForkWorktreeActivityError,
  ForkWorktreeCleanupStatusError,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProviderSessionJson,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  OrchestrationV2ThreadShell,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  WorktreeCleanupRules,
  StorageCleanupReport,
  StorageCleanupReportEntry,
  ForkWorktreeActivityInput,
  ForkWorktreeActivityResult,
  ForkWorktreeSizeInput,
  ForkWorktreeSizeResult,
  ForkWorktreeCleanupStatusInput,
  ForkWorktreeCleanupStatusResult,
  ForkWorktreeCleanupAge,
  ForkWorktreeCleanupProgress,
  ForkWorktreeCleanupProgressSnapshot,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cache from "effect/Cache";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { parse as parseYaml } from "yaml";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import { threadHasQueuedTurnStart } from "./orchestration-v2/ThreadSettlementService.ts";
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { isFilesystemRoot, managedWorktreesDirectories } from "./worktreesDirectory.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { removeLinkedWorktree } from "./vcs/worktreeRemoval.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { isNetworkPath } from "@t3tools/shared/path";

const decodeCleanupThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeCleanupSession = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);
// pnpm 11 writes this file as JSON, older versions as YAML.
const decodePnpmModulesManifest = Schema.decodeUnknownEffect(
  Schema.Struct({
    storeDir: Schema.String,
    virtualStoreDir: Schema.optional(Schema.String),
  }),
);

class PnpmModulesManifestParseError extends Schema.TaggedError<PnpmModulesManifestParseError>()(
  "PnpmModulesManifestParseError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not parse the pnpm modules manifest.";
  }
}

const DAY_MS = 86_400_000;
// Give settle scripts time to open terminals that protect the worktree.
const SETTLE_SCRIPT_GRACE_MS = 60_000;
// Worktree creation can precede its thread row, including review-guide checkouts.
const ORPHAN_WORKTREE_GRACE_MS = 60 * 60 * 1_000;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const REPORT_ENTRY_LIMIT = 200;
const isGitCommandError = Schema.is(GitCommandError);

function cleanupFailureReason(error: { readonly message: string }) {
  return isGitCommandError(error)
    ? `${error.command}: ${error.detail.split(/\r?\n/)[0]}${error.reason ? ` (${error.reason})` : ""}`
    : (error.message.split(/\r?\n/)[0] ?? error.message);
}

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeSettledAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeUnchanged;

/** Shared worktrees use the most protective local-file rule among their projects. */
function worktreeLocalChangesRules(
  rules: readonly WorktreeCleanupRules[],
  fallback: WorktreeCleanupRules,
) {
  return (
    rules.find((policy) => policy.worktreeKeepWhen === "any-local-files") ??
    rules.find((policy) => policy.worktreeKeepWhen === "uncommitted-changes") ??
    rules[0] ??
    fallback
  );
}

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

type LimitRecoverySettings = Pick<
  ServerSettings,
  "autoResumeLimitedThreads" | "snoozeLimitedThreads"
>;

export function storageCleanupThreadIdle(
  thread: OrchestrationV2ThreadShell,
  now: number,
  settings: LimitRecoverySettings,
): boolean {
  return thread.worktreePath !== null && threadIdle(thread, now, settings);
}

function threadIdle(
  thread: OrchestrationV2ThreadShell,
  now: number,
  settings: LimitRecoverySettings,
): boolean {
  return (
    thread.activeRunId === null &&
    (thread.status === "idle" ||
      thread.status === "completed" ||
      thread.status === "interrupted" ||
      thread.status === "failed" ||
      thread.status === "cancelled" ||
      thread.status === "rolled_back") &&
    (thread.pendingBackgroundTasks?.length ?? 0) === 0 &&
    thread.pendingRuntimeRequest === null &&
    !threadHasQueuedTurnStart(thread, now) &&
    !heldForLimitRecovery(thread, now, settings)
  );
}

// A run held for its usage-limit reset has its work still ahead of it, and a
// fresh worktree would otherwise look unchanged and be removed before it runs.
function heldForLimitRecovery(
  thread: OrchestrationV2ThreadShell,
  now: number,
  settings: LimitRecoverySettings,
): boolean {
  if (
    thread.status !== "failed" ||
    thread.lastErrorClass !== "usage_limit" ||
    !thread.usageLimitResetAt ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled"
  )
    return false;
  const resetMs = Date.parse(thread.usageLimitResetAt);
  const recovery = thread.limitRecovery;
  if (recovery?.runId === thread.latestRunId && recovery.resetAt === thread.usageLimitResetAt)
    // An auto-resume holds until its continuation replaces the failed run.
    return recovery.autoResume || (recovery.snooze === true && resetMs > now);
  // The recovery worker arms this failure on a later tick; hold it until then.
  // Like the worker, skip a reset that had already passed when the run ended.
  if (
    !Number.isFinite(resetMs) ||
    resetMs <= DateTime.toEpochMillis(thread.latestRunCompletedAt ?? thread.updatedAt)
  )
    return false;
  return settings.autoResumeLimitedThreads || (settings.snoozeLimitedThreads && resetMs > now);
}

type WorktreeActivityThread = Pick<OrchestrationV2ThreadShell, "createdAt"> &
  Partial<
    Pick<
      OrchestrationV2ThreadShell,
      "latestUserMessageAt" | "latestRunRequestedAt" | "latestRunStartedAt" | "latestRunCompletedAt"
    >
  >;

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt<Thread extends WorktreeActivityThread>(
  thread: Thread,
): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

/** Only a complete subagent or side chat chain within this worktree shares ownership. */
function worktreeOwner<T extends Pick<OrchestrationV2ThreadShell, "id" | "lineage">>(
  threads: ReadonlyArray<T>,
) {
  if (threads.length === 1) return threads[0];
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const tops = threads.filter((thread) => !byId.has(thread.lineage.parentThreadId!));
  if (tops.length !== 1) return undefined;
  const owner = tops[0]!;
  for (const thread of threads) {
    let current = thread;
    const seen = new Set<string>();
    while (current.id !== owner.id) {
      if (
        seen.has(current.id) ||
        (current.lineage.relationshipToParent !== "subagent" &&
          current.lineage.sideChat !== true) ||
        current.lineage.rootThreadId !== owner.lineage.rootThreadId
      )
        return undefined;
      seen.add(current.id);
      const parent = byId.get(current.lineage.parentThreadId!);
      if (parent === undefined) return undefined;
      current = parent;
    }
  }
  return owner;
}

type WorktreeFamilyThread =
  | OrchestrationV2ThreadShell
  | (WorktreeActivityThread &
      Pick<
        OrchestrationV2ThreadShell,
        | "id"
        | "projectId"
        | "lineage"
        | "settledAt"
        | "settledOverride"
        | "deletedAt"
        | "pinnedAt"
        | "updatedAt"
      >);

/** Deleted projection rows do not carry live run state. */
function isWorktreeThreadShell(thread: WorktreeFamilyThread): thread is OrchestrationV2ThreadShell {
  return "status" in thread;
}

/** Follow only genuine subagent and side-chat ancestry, including isolated worktrees. */
function worktreeParent(
  thread: WorktreeFamilyThread,
  threadsById: ReadonlyMap<OrchestrationV2ThreadShell["id"], WorktreeFamilyThread>,
) {
  if (thread.lineage.relationshipToParent !== "subagent" && thread.lineage.sideChat !== true)
    return undefined;
  const parent = threadsById.get(thread.lineage.parentThreadId!);
  return parent?.lineage.rootThreadId === thread.lineage.rootThreadId ? parent : undefined;
}

/** Extend upstream settlement inheritance to side chats and shared project policies. */
function worktreeSettlementChain(
  thread: OrchestrationV2ThreadShell,
  threadsById: ReadonlyMap<WorktreeFamilyThread["id"], WorktreeFamilyThread>,
  now: number,
  settings: LimitRecoverySettings,
) {
  if (thread.deletedAt !== null) return [];
  const chain = [thread];
  let current = thread;
  while (current.settledAt === null) {
    if (
      (current.lineage.relationshipToParent !== "subagent" && current.lineage.sideChat !== true) ||
      current.settledOverride === "active" ||
      current.pinnedAt !== null
    )
      return [];
    const parent = worktreeParent(current, threadsById);
    if (
      parent === undefined ||
      parent.deletedAt !== null ||
      !isWorktreeThreadShell(parent) ||
      chain.some((member) => member.id === parent.id) ||
      !threadIdle(parent, now, settings)
    )
      return [];
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** A deleted ancestor retires its dependent checkout, but never an independent thread. */
function worktreeDeletedAncestor(
  thread: WorktreeFamilyThread,
  threadsById: ReadonlyMap<OrchestrationV2ThreadShell["id"], WorktreeFamilyThread>,
) {
  let current: WorktreeFamilyThread | undefined = thread;
  const visited = new Set<OrchestrationV2ThreadShell["id"]>();
  while (current !== undefined && !visited.has(current.id)) {
    if (current.deletedAt !== null) return current;
    if (current.settledOverride === "active") return undefined;
    visited.add(current.id);
    current = worktreeParent(current, threadsById);
  }
  return undefined;
}

/** Dependent checkouts retain the most protective cleanup rules in their parent family. */
function worktreeCleanupPolicyMembers(
  threads: readonly WorktreeFamilyThread[],
  threadsById: ReadonlyMap<WorktreeFamilyThread["id"], WorktreeFamilyThread>,
) {
  const members = new Map<WorktreeFamilyThread["id"], WorktreeFamilyThread>();
  for (const thread of threads) {
    let current: WorktreeFamilyThread | undefined = thread;
    while (current !== undefined && !members.has(current.id)) {
      members.set(current.id, current);
      current = worktreeParent(current, threadsById);
    }
  }
  return [...members.values()];
}

/** Share the exact activity and settlement clocks between inspection and deletion. */
function worktreeCleanupClocks(
  threads: readonly OrchestrationV2ThreadShell[],
  threadsById: ReadonlyMap<OrchestrationV2ThreadShell["id"], WorktreeFamilyThread>,
  now: number,
  settings: LimitRecoverySettings,
) {
  let activityAt: number | null = null;
  for (const thread of threads) {
    let current: WorktreeFamilyThread | undefined = thread;
    const visited = new Set<WorktreeFamilyThread["id"]>();
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);
      activityAt = Math.max(activityAt ?? 0, storageCleanupActivityAt(current));
      current = worktreeParent(current, threadsById);
    }
  }
  const settlements = threads.map(
    (thread) =>
      worktreeSettlementChain(thread, threadsById, now, settings).at(-1)?.settledAt ?? null,
  );
  const settledAt =
    activityAt === null || settlements.some((timestamp) => timestamp === null)
      ? null
      : Math.max(activityAt, ...settlements.map((timestamp) => DateTime.toEpochMillis(timestamp!)));
  return { activityAt, settledAt };
}

/** Display the smaller enabled age; policy thresholds still decide eligibility independently. */
function worktreeCleanupAge(
  clocks: ReturnType<typeof worktreeCleanupClocks>,
  policies: readonly WorktreeCleanupRules[],
  deletionTriggered = false,
): ForkWorktreeCleanupAge {
  if (policies.some((policy) => !worktreeCleanupEnabled(policy)))
    return { basis: "off", since: null };
  if (deletionTriggered && policies.every((policy) => policy.worktreeOnDelete))
    return { basis: "deleted", since: null };
  const activity = policies.some((policy) => policy.worktreeAfterDays !== null);
  const settled = policies.some((policy) => policy.worktreeSettledAfterDays !== null);
  if (activity && settled) return { basis: "both", since: clocks.settledAt ?? clocks.activityAt };
  if (activity) return { basis: "activity", since: clocks.activityAt };
  if (settled) return { basis: "settled", since: clocks.settledAt };
  return { basis: "none", since: null };
}

/** Squash/rebase merges require the merged PR to name this exact head commit. */
export function storageCleanupPullRequestMerged(
  pullRequest: Pick<
    GitManager.GitBranchPullRequest,
    "state" | "headRef" | "baseRef" | "headSha"
  > | null,
  worktree: {
    readonly branch: string;
    readonly defaultBranch: string;
    readonly headSha: string;
    readonly integrated: boolean;
  },
): boolean {
  return (
    pullRequest?.state === "merged" &&
    (worktree.integrated ||
      (pullRequest.headRef === worktree.branch &&
        pullRequest.baseRef === worktree.defaultBranch &&
        pullRequest.headSha === worktree.headSha))
  );
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    readonly getWorktreeActivity: (
      input: ForkWorktreeActivityInput,
    ) => Effect.Effect<ForkWorktreeActivityResult, ForkWorktreeActivityError>;
    readonly getWorktreeCleanupStatus: (
      input: ForkWorktreeCleanupStatusInput,
    ) => Effect.Effect<ForkWorktreeCleanupStatusResult, ForkWorktreeCleanupStatusError>;
    readonly getWorktreeSize: (
      input: ForkWorktreeSizeInput,
    ) => Effect.Effect<ForkWorktreeSizeResult, GitCommandError>;
    readonly runNow: Effect.Effect<StorageCleanupReport, ServerSettingsError>;
    readonly latestReport: Effect.Effect<StorageCleanupReport | null>;
    readonly reports: Stream.Stream<StorageCleanupReport | null>;
    readonly subscribeWorktreeProgress: (
      input: ForkWorktreeActivityInput,
    ) => Stream.Stream<ForkWorktreeCleanupProgressSnapshot>;
    readonly trackWorktreeRemoval: <A, E extends { readonly message: string }, R>(
      worktreePath: string,
      removal: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/storageCleanup") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const orphanSizes = new Map<string, number | null>();
  const progressRef = yield* SubscriptionRef.make<ReadonlyMap<string, ForkWorktreeCleanupProgress>>(
    new Map(),
  );
  /** Publish per-path transitions without waiting for the entire sweep to finish. */
  const noteProgress = (
    progress: Omit<ForkWorktreeCleanupProgress, "source">,
    source: ForkWorktreeCleanupProgress["source"] = "automatic",
  ) =>
    SubscriptionRef.update(progressRef, (previous) => {
      const next = new Map(previous);
      next.set(progress.worktreePath, { ...progress, source });
      return next;
    });
  /** Observe explicit removals while leaving their permissions, confirmation and Git guards intact. */
  const trackWorktreeRemoval = Effect.fn("StorageCleanup.trackWorktreeRemoval")(
    <A, E extends { readonly message: string }, R>(
      worktreePath: string,
      removal: Effect.Effect<A, E, R>,
    ) =>
      noteProgress(
        {
          worktreePath: path.resolve(worktreePath),
          state: "deleting",
          phase: "delete",
          reason: null,
        },
        "manual",
      ).pipe(
        Effect.andThen(removal),
        Effect.tap(() =>
          noteProgress(
            {
              worktreePath: path.resolve(worktreePath),
              state: "removed",
              phase: "delete",
              reason: null,
            },
            "manual",
          ),
        ),
        Effect.tapError((error) =>
          noteProgress(
            {
              worktreePath: path.resolve(worktreePath),
              state: "failed",
              phase: "delete",
              reason: cleanupFailureReason(error),
            },
            "manual",
          ),
        ),
        Effect.onInterrupt(() =>
          noteProgress(
            {
              worktreePath: path.resolve(worktreePath),
              state: "failed",
              phase: "delete",
              reason:
                "Deletion was interrupted. Check whether the worktree still exists before retrying.",
            },
            "manual",
          ),
        ),
      ),
  );
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const isWindows = yield* HostProcess.isWindows;
  const pathKey = (target: string) => {
    const resolved = path.resolve(target);
    return isWindows ? resolved.toLowerCase() : resolved;
  };
  const inside = (root: string, target: string) => {
    const relative = path.relative(pathKey(root), pathKey(target));
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const hasTerminal = (worktreePath: string) =>
    [...liveTerminals.values()]
      .flatMap((entries) => [...entries.values()])
      .some((terminal) => {
        if (terminal.status !== "starting" && terminal.status !== "running") return false;
        const cwd = path.resolve(terminal.cwd);
        return (
          (terminal.worktreePath !== null &&
            pathKey(terminal.worktreePath) === pathKey(worktreePath)) ||
          pathKey(cwd) === pathKey(worktreePath) ||
          inside(worktreePath, cwd)
        );
      });

  // pnpm imports packages by clone or reflink when its store shares a device
  // with the worktree. Those files have one link but share blocks with the
  // store, so removing them frees almost nothing. A store on another device
  // forces real copies, which still count.
  const sharedPnpmVirtualStore = Effect.fnUntraced(
    function* (root: string) {
      const nodeModules = path.join(root, "node_modules");
      const text = yield* fs.readFileString(path.join(nodeModules, ".modules.yaml"));
      const manifest = yield* decodePnpmModulesManifest(
        yield* Effect.try({
          try: () => parseYaml(text),
          catch: (cause) => new PnpmModulesManifestParseError({ cause }),
        }),
      );
      // An agent can write this manifest, and statting a network path makes
      // Windows sign in to its host with the user's NTLM credentials.
      if (isNetworkPath(manifest.storeDir) || isNetworkPath(manifest.virtualStoreDir ?? "")) {
        return null;
      }
      const virtualStore = path.resolve(nodeModules, manifest.virtualStoreDir ?? ".pnpm");
      const [store, virtual] = yield* Effect.all([
        fs.stat(manifest.storeDir),
        fs.stat(virtualStore),
      ]);
      return store.dev === virtual.dev ? virtualStore : null;
    },
    Effect.orElseSucceed(() => null),
  );

  const measureWorktree = Effect.fn("storageCleanup.measureWorktree")(
    function* (worktreePath: string) {
      const root = yield* fs.realPath(worktreePath);
      const skipped = yield* sharedPnpmVirtualStore(root);
      const pending = [root];
      let entries = 1;
      let bytes = 0;
      while (pending.length > 0) {
        const target = pending.pop()!;
        if (target === skipped) continue;
        // Effect's stat follows links. Probe with readLink first to get lstat
        // semantics, including skipping dangling links and directory links.
        const isLink = yield* fs.readLink(target).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) =>
              error.cause instanceof Error &&
              "code" in error.cause &&
              error.cause.code === "EINVAL",
            () => Effect.succeed(false),
          ),
        );
        if (isLink) continue;
        if ((yield* fs.realPath(target)) !== target) return null;
        const stat = yield* fs.stat(target);
        if (stat.type === "File") {
          // Removing a shared hardlink leaves its blocks allocated.
          if (Option.getOrElse(stat.nlink, () => 1n) !== 1n) continue;
          bytes += Option.match(stat.blocks, {
            onNone: () => Number(stat.size),
            onSome: (blocks) => Number(blocks * 512n),
          });
        } else if (stat.type === "Directory") {
          const names = yield* fs.readDirectory(target);
          entries += names.length;
          if (entries > 2_000_000) return null;
          for (const name of names) {
            const child = path.join(target, name);
            if (!inside(root, child)) return null;
            pending.push(child);
          }
        }
      }
      return bytes;
    },
    Effect.timeout("30 seconds"),
    Effect.orElseSucceed(() => null),
  );

  const measurementSlots = yield* Semaphore.make(2);
  const measuredSizes = yield* Cache.makeWith(
    (worktreePath: string) => measurementSlots.withPermits(1)(measureWorktree(worktreePath)),
    { capacity: 256, timeToLive: () => "1 minute" },
  );

  /** Estimate only a registered linked worktree, never an arbitrary directory or shared Git store. */
  const getWorktreeSize = Effect.fn("StorageCleanup.getWorktreeSize")(function* (
    input: ForkWorktreeSizeInput,
  ) {
    const target = pathKey(path.resolve(input.cwd, input.path));
    const refs = yield* git.listRefs({ cwd: input.cwd, worktreesOnly: true });
    const registered = refs.refs.some(
      (ref) => ref.worktreePath !== null && pathKey(ref.worktreePath) === target,
    );
    if (!registered) return { isLinkedWorktree: false, reclaimableBytes: null };
    const linked = yield* fs.stat(path.join(target, ".git")).pipe(
      Effect.map((stat) => stat.type === "File"),
      Effect.orElseSucceed(() => false),
    );
    if (!linked) return { isLinkedWorktree: false, reclaimableBytes: null };
    const bytes = yield* Cache.get(measuredSizes, target);
    return { isLinkedWorktree: true, reclaimableBytes: bytes };
  });

  /** Include older settled and archived threads without sending their conversations to the client. */
  const getWorktreeActivity = Effect.fn("StorageCleanup.getWorktreeActivity")(
    function* (input: ForkWorktreeActivityInput) {
      const requestedPaths = new Set(input.worktreePaths);
      if (requestedPaths.size === 0) return { worktrees: [] };
      const associations = yield* projections
        .getThreadWorktreePaths({ includeArchived: true })
        .pipe(NodeSqliteClient.readOnly);
      const threadIds = associations
        .filter((thread) => requestedPaths.has(thread.worktreePath))
        .map((thread) => thread.threadId);
      if (threadIds.length === 0) return { worktrees: [] };
      const snapshot = yield* projections
        .getShellSnapshot({ threadIds })
        .pipe(NodeSqliteClient.readOnly);
      const threadsById = yield* readWorktreeAncestors([
        ...snapshot.threads,
        ...snapshot.archivedThreads,
      ]);
      const threadsByPath = Map.groupBy(
        [...snapshot.threads, ...snapshot.archivedThreads],
        (thread) => thread.worktreePath,
      );
      const settings = yield* settingsService.getSettings;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const worktrees: ForkWorktreeActivityResult["worktrees"][number][] = [];
      for (const [worktreePath, threads] of threadsByPath) {
        if (worktreePath === null) continue;
        let latestActivityAt = 0;
        for (const thread of threads) {
          latestActivityAt = Math.max(
            latestActivityAt,
            storageCleanupActivityAt(thread),
            thread.latestVisibleMessage === null
              ? 0
              : DateTime.toEpochMillis(thread.latestVisibleMessage.updatedAt),
          );
        }
        worktrees.push({
          worktreePath,
          latestActivityAt,
          ...(threads.every((thread) => worktreeDeletedAncestor(thread, threadsById) !== undefined)
            ? { parentDeleted: true }
            : {}),
          threadsSettled: threads.every(
            (thread) => worktreeSettlementChain(thread, threadsById, now, settings).length > 0,
          ),
        });
      }
      return { worktrees };
    },
    Effect.mapError(
      (cause) =>
        new ForkWorktreeActivityError({
          message: "Unable to load worktree thread activity.",
          cause,
        }),
    ),
  );

  // Large snapshots take seconds; use the reader worker instead of blocking the event loop.
  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const snapshot = yield* projections.getShellSnapshot().pipe(NodeSqliteClient.readOnly);
    const projects = yield* projectStore.listShells();
    return { projects, threads: [...snapshot.threads, ...snapshot.archivedThreads] };
  });

  /** Include deleted owners when their cleanup policy still controls a shared checkout. */
  const readDeletedWorktreeThreads = Effect.fn("StorageCleanup.readDeletedWorktreeThreads")(
    function* () {
      const rows = yield* sql<{ payload_json: string; workspaceRoot: string }>`
        SELECT t.payload_json, p.workspace_root AS "workspaceRoot"
        FROM orchestration_v2_projection_threads t
        JOIN projection_projects p ON p.project_id = t.project_id
        WHERE t.deleted_at IS NOT NULL
      `.pipe(NodeSqliteClient.readOnly);
      return yield* Effect.forEach(rows, (row) =>
        decodeCleanupThread(row.payload_json).pipe(
          Effect.map((thread) => ({ ...thread, workspaceRoot: row.workspaceRoot })),
        ),
      );
    },
  );

  /** Load only missing ancestors, including deleted parents and parents using the project checkout. */
  const readWorktreeAncestors = Effect.fn("StorageCleanup.readWorktreeAncestors")(function* (
    threads: readonly OrchestrationV2ThreadShell[],
  ) {
    const deleted = yield* readDeletedWorktreeThreads();
    const byId = new Map([...deleted, ...threads].map((thread) => [thread.id, thread]));
    const queue: WorktreeFamilyThread[] = [...threads];
    const visited = new Set<OrchestrationV2ThreadShell["id"]>();
    for (const thread of queue) {
      if (visited.has(thread.id)) continue;
      visited.add(thread.id);
      const parentId = thread.lineage.parentThreadId;
      if (
        parentId === null ||
        (thread.lineage.relationshipToParent !== "subagent" && thread.lineage.sideChat !== true)
      )
        continue;
      let parent = byId.get(parentId);
      if (parent === undefined) {
        parent = (yield* projections.getThreadShell(parentId)) ?? undefined;
        if (parent !== undefined) byId.set(parentId, parent);
      }
      if (parent !== undefined) queue.push(parent);
    }
    return byId;
  });

  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of projects) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (pathKey(projectPath) === pathKey(worktreePath) || inside(worktreePath, projectPath))
        return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (pathKey(realPath) === pathKey(worktreePath) || inside(worktreePath, realPath))
        return true;
    }
    return false;
  });

  const reportOrphanWorktrees = Effect.fn("StorageCleanup.reportOrphanWorktrees")(function* (
    roots: ReadonlyArray<string>,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
    entries: StorageCleanupReportEntry[],
  ) {
    const rows = yield* sql<{ worktreePath: string }>`
      SELECT DISTINCT json_extract(payload_json, '$.worktreePath') AS "worktreePath"
      FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.worktreePath') IS NOT NULL
    `.pipe(NodeSqliteClient.readOnly);
    const referenced = new Set<string>();
    for (const row of rows) {
      const resolved = path.resolve(row.worktreePath);
      referenced.add(pathKey(resolved));
      referenced.add(
        pathKey(yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved))),
      );
    }
    const referencedAncestors = new Set<string>();
    for (let ancestor of referenced) {
      while (roots.some((root) => inside(root, ancestor))) {
        ancestor = pathKey(path.dirname(ancestor));
        referencedAncestors.add(ancestor);
      }
    }
    const projectRoots = (yield* Effect.forEach(
      yield* Effect.filter(projects, (project) =>
        fs.exists(path.resolve(project.workspaceRoot)).pipe(Effect.orElseSucceed(() => true)),
      ),
      (project) => {
        const resolved = path.resolve(project.workspaceRoot);
        return fs.realPath(resolved).pipe(
          Effect.orElseSucceed(() => resolved),
          Effect.map((realPath) => [resolved, realPath]),
        );
      },
    )).flat();
    const inProject = (target: string, managedRoot: string) =>
      projectRoots.some(
        (root) =>
          !inside(root, managedRoot) && (pathKey(root) === pathKey(target) || inside(root, target)),
      );
    const directories = Effect.fnUntraced(function* (parent: string, managedRoot: string) {
      if (inProject(parent, managedRoot)) return [];
      const result: string[] = [];
      for (const name of yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))) {
        const target = path.join(parent, name);
        if (!inside(parent, target) || inProject(target, managedRoot)) continue;
        const directory = yield* Effect.gen(function* () {
          if (pathKey(yield* fs.realPath(target)) !== pathKey(target)) return false;
          return (yield* fs.stat(target)).type === "Directory";
        }).pipe(Effect.orElseSucceed(() => false));
        if (directory) result.push(target);
      }
      return result;
    });
    // Let the first walk time out and cache unmeasurable folders; later walks share the remaining budget.
    const now = yield* Clock.currentTimeMillis;
    const measurementDeadline = now + 30_000;
    let firstMeasurement = true;
    const reported = new Set<string>();
    const report = Effect.fnUntraced(
      function* (worktreePath: string) {
        const key = pathKey(worktreePath);
        if (
          reported.has(key) ||
          referenced.has(key) ||
          referencedAncestors.has(key) ||
          projectRoots.some((root) => pathKey(root) === key || inside(worktreePath, root))
        )
          return;
        const modified = Option.getOrNull((yield* fs.stat(worktreePath)).mtime);
        if (modified !== null && modified.getTime() > now - ORPHAN_WORKTREE_GRACE_MS) return;
        const gitPath = path.join(worktreePath, ".git");
        const linked = (yield* fs.exists(gitPath)) && (yield* fs.stat(gitPath)).type === "File";
        reported.add(key);
        const remaining = measurementDeadline - (yield* Clock.currentTimeMillis);
        if (!orphanSizes.has(key) && (firstMeasurement || remaining > 0)) {
          const measured = yield* measureWorktree(worktreePath).pipe(
            firstMeasurement ? Effect.asSome : Effect.timeoutOption(remaining),
          );
          firstMeasurement = false;
          if (Option.isSome(measured)) orphanSizes.set(key, measured.value);
        }
        const bytes = orphanSizes.get(key) ?? null;
        entries.push({
          kind: "worktree",
          outcome: "kept",
          reason: linked
            ? "No thread uses this worktree"
            : "No thread uses this folder, and it isn't a git worktree",
          path: worktreePath,
          projectPath: null,
          threadId: null,
          threadTitle: null,
          bytes,
          files: null,
        });
      },
      Effect.orElseSucceed(() => undefined),
    );
    // Linked worktrees can sit deeper inside a plain folder, like <repository>/replay/<n>. Ask
    // the projects' Git for them rather than walking folders that may hold large non-git trees.
    let registered: ReadonlyArray<string> | undefined;
    const nestedWorktrees = Effect.fnUntraced(function* (folder: string, managedRoot: string) {
      if (yield* fs.exists(path.join(folder, ".git"))) return [];
      registered ??= (yield* Effect.forEach(new Set(projectRoots), (root) =>
        git.listWorktreePaths(root).pipe(Effect.orElseSucceed((): string[] => [])),
      )).flat();
      // Locked registrations outlive their directory, whose path may since hold something else.
      return yield* Effect.filter(
        registered.filter(
          (worktree) => inside(folder, worktree) && !inProject(worktree, managedRoot),
        ),
        (worktree) =>
          Effect.gen(function* () {
            if (pathKey(yield* fs.realPath(worktree)) !== pathKey(worktree)) return false;
            return (yield* fs.stat(path.join(worktree, ".git"))).type === "File";
          }).pipe(Effect.orElseSucceed(() => false)),
      );
    });
    for (const root of roots) {
      // Worktrees can be <root>/<repository>/<branch> or explicitly <root>/<name>.
      for (const projectDirectory of yield* directories(root, root)) {
        yield* Effect.gen(function* () {
          if (referenced.has(pathKey(projectDirectory))) return;
          const gitPath = path.join(projectDirectory, ".git");
          if (yield* fs.exists(gitPath)) {
            if ((yield* fs.stat(gitPath)).type === "File") yield* report(projectDirectory);
            return;
          }
          for (const worktreePath of yield* directories(projectDirectory, root)) {
            const nested = yield* nestedWorktrees(worktreePath, root);
            for (const target of nested.length > 0 ? nested : [worktreePath]) yield* report(target);
          }
        }).pipe(Effect.orElseSucceed(() => undefined));
      }
    }
    for (const key of orphanSizes.keys()) {
      if (!reported.has(key)) orphanSizes.delete(key);
    }
  });

  /** Refuse missing repositories and locked indexes without depending on branch names. */
  const repositoryUnavailable = Effect.fn("StorageCleanup.repositoryUnavailable")(function* (
    cwd: string,
  ) {
    const failure = (detail: string) =>
      new GitCommandError({
        operation: "StorageCleanup.repositoryUnavailable",
        command: "git",
        cwd,
        detail,
      });
    // Return null for missing/non-repository cwd; force untranslated git diagnostics for matching.
    const read = Effect.fnUntraced(function* (args: string[]) {
      const result = yield* git
        .execute({
          operation: "StorageCleanup.repositoryUnavailable",
          cwd,
          args,
          env: { LC_ALL: "C" },
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.flatMap(fs.exists(cwd), (exists) =>
              exists ? Effect.fail(error) : Effect.succeed(null),
            ),
          ),
        );
      if (result === null) return null;
      if (result.exitCode === 0) return result;
      const diagnostic = result.stderr.toLowerCase();
      if (
        diagnostic.includes("not a git repository") ||
        diagnostic.includes("gitfile does not point to a valid repository")
      )
        return null;
      return yield* failure(
        result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      );
    });
    const index = yield* read(["rev-parse", "--git-path", "index"]);
    if (index === null) return true;
    if (yield* fs.exists(`${path.resolve(cwd, index.stdout.trim())}.lock`))
      return yield* failure(
        "Git index is locked. Status will resume when the index lock is removed.",
      );
    return false;
  });

  const localChangesReason = Effect.fn("StorageCleanup.localChangesReason")(function* (
    cwd: string,
    rules: WorktreeCleanupRules,
  ) {
    const status = yield* git.execute({
      operation: "StorageCleanup.localChanges",
      cwd,
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--ignore-submodules=none",
        rules.worktreeKeepWhen === "tracked-changes"
          ? "--untracked-files=no"
          : "--untracked-files=all",
      ],
      maxOutputBytes: 64 * 1024,
    });
    if (status.stdoutTruncated) return "local changes exceed the inspection limit";
    const records = status.stdout.split("\0").filter(Boolean);
    let count = 0;
    for (let i = 0; i < records.length; i++) {
      count++;
      if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
    }
    if (count > 0) return `has uncommitted changes (${count} ${count === 1 ? "file" : "files"})`;
    if (rules.worktreeKeepWhen !== "any-local-files") return null;
    const ignored = yield* git.execute({
      operation: "StorageCleanup.ignoredFiles",
      cwd,
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      maxOutputBytes: 64 * 1024,
    });
    if (ignored.stdoutTruncated) return "ignored files exceed the inspection limit";
    const file = ignored.stdout
      .split("\0")
      .find((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));
    return file === undefined ? null : `has ignored files (${file})`;
  });

  /** Inspect local-file protection without fetching remotes or running cleanup. */
  const getWorktreeCleanupStatus = Effect.fn("StorageCleanup.getWorktreeCleanupStatus")(
    function* (input: ForkWorktreeCleanupStatusInput) {
      const requestedPaths = new Set(
        input.worktreePaths.map((directory) => path.resolve(directory)),
      );
      if (requestedPaths.size === 0) return { worktrees: [] };
      const associations = yield* projections
        .getThreadWorktreePaths({ includeArchived: true })
        .pipe(NodeSqliteClient.readOnly);
      const threadIds = associations
        .filter((thread) => requestedPaths.has(path.resolve(thread.worktreePath)))
        .map((thread) => thread.threadId);
      const snapshot = yield* projections
        .getShellSnapshot({ threadIds })
        .pipe(NodeSqliteClient.readOnly);
      const threadsById = yield* readWorktreeAncestors([
        ...snapshot.threads,
        ...snapshot.archivedThreads,
      ]);
      const liveByPath = Map.groupBy(
        [...snapshot.threads, ...snapshot.archivedThreads].filter(
          (thread) => thread.worktreePath !== null,
        ),
        (thread) => path.resolve(thread.worktreePath!),
      );
      const deletedByPath = Map.groupBy(
        (yield* readDeletedWorktreeThreads()).filter((thread) => thread.worktreePath !== null),
        (thread) => path.resolve(thread.worktreePath!),
      );
      const settings = yield* settingsService.getSettings;
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const fallback = resolveWorktreeCleanup(settings, input.projectId);
      const worktrees = yield* Effect.forEach(
        [...requestedPaths],
        (worktreePath) =>
          Effect.gen(function* () {
            const liveThreads = liveByPath.get(worktreePath) ?? [];
            const deletedThreads = deletedByPath.get(worktreePath) ?? [];
            const deletedOwner = deletedThreads.find(
              (thread) =>
                resolveWorktreeCleanup(settings, thread.projectId).worktreeOnDelete &&
                worktreeOwner([thread, ...liveThreads]) === thread,
            );
            const members =
              deletedOwner !== undefined || liveThreads.length === 0
                ? [...deletedThreads, ...liveThreads]
                : liveThreads;
            const deletedAncestors = liveThreads.map((thread) =>
              worktreeDeletedAncestor(thread, threadsById),
            );
            const inheritedDeletion =
              liveThreads.length > 0 &&
              deletedAncestors.every((ancestor) => ancestor !== undefined);
            const policies = worktreeCleanupPolicyMembers(members, threadsById).map((member) =>
              resolveWorktreeCleanup(settings, member.projectId),
            );
            const rules = worktreeLocalChangesRules(policies, fallback);
            const age = worktreeCleanupAge(
              worktreeCleanupClocks(liveThreads, threadsById, now, settings),
              policies.length === 0 ? [fallback] : policies,
              inheritedDeletion || deletedOwner !== undefined,
            );
            const inspection = yield* localChangesReason(worktreePath, rules).pipe(Effect.result);
            if (inspection._tag === "Failure")
              return {
                worktreePath,
                keepWhen: rules.worktreeKeepWhen,
                status: "unavailable" as const,
                reason: "Unable to inspect local files.",
                age,
              };
            return {
              worktreePath,
              keepWhen: rules.worktreeKeepWhen,
              status: inspection.success === null ? ("clean" as const) : ("dirty" as const),
              reason: inspection.success,
              age,
            };
          }),
        { concurrency: 2 },
      );
      return { worktrees };
    },
    Effect.mapError(
      (cause) =>
        new ForkWorktreeCleanupStatusError({
          message: "Unable to inspect worktree cleanup protection.",
          cause,
        }),
    ),
  );

  const submoduleRemoval = Effect.fn("StorageCleanup.submoduleRemoval")(
    function* (cwd: string, rules: WorktreeCleanupRules) {
      const inspect = (args: string[], maxOutputBytes = 64 * 1024) =>
        git.execute({
          operation: "StorageCleanup.submodules",
          cwd,
          args,
          maxOutputBytes,
        });
      const admin = yield* inspect(["rev-parse", "--absolute-git-dir"]);
      if (admin.stdoutTruncated || admin.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const modules = path.join(admin.stdout.replace(/\n$/, ""), "modules");
      const stored = yield* fs.exists(modules);
      if (!stored && !(yield* fs.exists(path.join(cwd, ".gitmodules"))))
        return { force: false, reason: null };
      const populated = yield* inspect([
        "submodule",
        "foreach",
        "--recursive",
        "--quiet",
        'printf "%s\\0" "$toplevel/$sm_path"',
      ]);
      if (populated.stdoutTruncated || populated.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const paths = populated.stdout.split("\0").filter(Boolean);
      const pending = [modules];
      for (const submodule of paths) {
        const directory = yield* inspect(["-C", submodule, "rev-parse", "--absolute-git-dir"]);
        if (directory.stdoutTruncated || directory.stderrTruncated)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        pending.push(directory.stdout.replace(/\n$/, ""));
      }
      const visited = new Set<string>();
      while (pending.length > 0) {
        const directory = pending.pop()!;
        if (!(yield* fs.exists(directory))) continue;
        const canonical = yield* fs.realPath(directory);
        if (visited.has(canonical)) continue;
        visited.add(canonical);
        if (visited.size > 10_000)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        if ((yield* fs.stat(directory)).type !== "Directory")
          return { force: false, reason: "submodule repository could not be inspected" };
        if (yield* fs.exists(path.join(directory, "HEAD"))) {
          const unpushed = yield* inspect([
            "--git-dir",
            directory,
            "--work-tree",
            cwd,
            "rev-list",
            "--max-count=1",
            "HEAD",
            "--all",
            "--reflog",
            "--not",
            "--remotes",
          ]);
          if (unpushed.stdoutTruncated || unpushed.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          if (unpushed.stdout.trim() !== "")
            return { force: false, reason: "submodule has commits not on a remote-tracking ref" };
          pending.push(path.join(directory, "modules"));
        } else {
          for (const name of yield* fs.readDirectory(directory))
            pending.push(path.join(directory, name));
        }
      }
      // Check files after walking stored history to shorten the gap before forced removal.
      for (const submodule of paths) {
        const changes = yield* localChangesReason(submodule, rules);
        if (changes !== null) return { force: false, reason: `submodule ${changes}` };
      }
      const force = stored || paths.length > 0;
      if (force && rules.worktreeKeepWhen !== "tracked-changes") {
        const root = yield* fs.realPath(cwd);
        // Git status and foreach omit files inside deinitialized gitlink directories.
        const populatedPaths = new Set(paths.map(pathKey));
        const unchecked: string[] = [];
        for (const repository of [root, ...paths]) {
          const index = yield* inspect(
            ["-C", repository, "ls-files", "--stage", "-z"],
            16 * 1024 * 1024,
          );
          if (index.stdoutTruncated || index.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          for (const entry of index.stdout.split("\0")) {
            if (!entry.startsWith("160000 ")) continue;
            const submodule = path.resolve(repository, entry.slice(entry.indexOf("\t") + 1));
            if (!inside(root, submodule))
              return { force: false, reason: "submodules could not be inspected" };
            if (!populatedPaths.has(pathKey(submodule)) && (yield* fs.exists(submodule)))
              unchecked.push(submodule);
          }
        }
        let inspected = unchecked.length;
        while (unchecked.length > 0) {
          if (inspected > 10_000)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          const target = unchecked.pop()!;
          if (
            (yield* fs.realPath(target)) !== path.resolve(target) ||
            (yield* fs.stat(target)).type !== "Directory"
          )
            return { force: false, reason: "submodule has local files" };
          if (path.basename(target) === "node_modules") continue;
          const names = yield* fs.readDirectory(target);
          inspected += names.length;
          for (const name of names) unchecked.push(path.join(target, name));
        }
      }
      return { force, reason: null };
    },
    Effect.orElseSucceed(() => ({ force: false, reason: "submodules could not be inspected" })),
  );

  const cleanupGit = Effect.fn("StorageCleanup.cleanupGit")(function* (
    cwd: string,
    args: string[],
    command: string,
  ) {
    const result = yield* git.execute({
      operation: "StorageCleanup.cleanupGit",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0)
      return yield* new GitCommandError({
        operation: "StorageCleanup.cleanupGit",
        command,
        cwd,
        detail: result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      });
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
    entries: StorageCleanupReportEntry[],
  ) {
    if (!anyWorktreePolicy(serverSettings, worktreeCleanupEnabled))
      return { waiting: false, kept: [] };
    let waiting = false;
    const kept: string[] = [];
    const roots: Array<string> = [];
    for (const directory of managedWorktreesDirectories(
      serverSettings,
      config.worktreesDir,
      path,
      yield* HostProcess.HomeDirectory,
    )) {
      const root = yield* fs.exists(directory).pipe(
        Effect.flatMap((exists) => (exists ? fs.realPath(directory) : Effect.succeed(null))),
        Effect.orElseSucceed(() => null),
      );
      if (root !== null && !isFilesystemRoot(root, path)) roots.push(root);
    }
    const worktreePathReason = Effect.fn("StorageCleanup.worktreePathReason")(function* (
      worktreePath: string,
    ) {
      // Allow symlinked parents, never a symlinked worktree directory.
      const realPath = yield* fs.realPath(worktreePath);
      const realParent = yield* fs.realPath(path.dirname(worktreePath));
      if (realPath !== path.join(realParent, path.basename(worktreePath)))
        return "worktree is a symbolic link";
      if (!roots.some((root) => inside(root, realPath)))
        return "outside the managed worktree folder";
      if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File")
        return "not a linked worktree";
      return null;
    });
    const allDeletedThreads = yield* readDeletedWorktreeThreads();
    const deletedThreads = allDeletedThreads.filter((thread) => thread.worktreePath !== null);
    const snapshot = yield* readThreads();
    const liveThreadsById = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
    const allThreadsById = new Map(
      [...allDeletedThreads, ...snapshot.threads].map((thread) => [thread.id, thread]),
    );
    const refreshedDefaultRefs = new Map<string, Set<string>>();
    const defaultBranches = new Map<string, string | null>();
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    const deletedByPath = Map.groupBy(deletedThreads, (thread) =>
      path.resolve(thread.worktreePath!),
    );
    const candidates = [
      ...[...groups].map(
        ([worktreePath, group]) =>
          // A deleted thread still owns the worktree its remaining subagents share,
          // but only deletion cleanup acts on it; otherwise the live rules apply.
          deletedByPath
            .get(worktreePath)
            ?.find(
              (deleted) =>
                resolveWorktreeCleanup(serverSettings, deleted.projectId).worktreeOnDelete &&
                worktreeOwner([deleted, ...group]) === deleted,
            ) ??
          worktreeOwner(group) ??
          group[0]!,
      ),
      ...[...deletedByPath]
        .filter(([worktreePath]) => !groups.has(worktreePath))
        .map(([, threads]) => worktreeOwner(threads) ?? threads[0]!),
    ];
    for (const thread of candidates) {
      const worktreePath = path.resolve(thread.worktreePath!);
      const group = groups.get(worktreePath) ?? [];
      const settlementChain = group.flatMap((member) =>
        worktreeSettlementChain(member, allThreadsById, now, serverSettings),
      );
      const clocks = worktreeCleanupClocks(group, allThreadsById, now, serverSettings);
      const activityAt = clocks.activityAt ?? 0;
      const deleted = "workspaceRoot" in thread;
      const deletedAncestors = group.map((member) =>
        worktreeDeletedAncestor(member, allThreadsById),
      );
      const inheritedDeletion =
        group.length > 0 &&
        deletedAncestors.every(
          (ancestor) =>
            ancestor !== undefined &&
            resolveWorktreeCleanup(serverSettings, ancestor.projectId).worktreeOnDelete,
        ) &&
        group.every(
          (member) => resolveWorktreeCleanup(serverSettings, member.projectId).worktreeOnDelete,
        );
      const deletionCleanup = deleted || inheritedDeletion;
      const members = deleted ? [...(deletedByPath.get(worktreePath) ?? []), ...group] : group;
      const policies = worktreeCleanupPolicyMembers(members, allThreadsById).map((member) => ({
        thread: member,
        settings: resolveWorktreeCleanup(serverSettings, member.projectId),
      }));
      if (!policies.some((policy) => worktreeCleanupEnabled(policy.settings))) continue;
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      const checkUnchanged = policies.some((policy) => policy.settings.worktreeUnchanged);
      const checkMerged = policies.some((policy) => policy.settings.worktreeOnMerge);
      const localChangesRules = worktreeLocalChangesRules(
        policies.map((policy) => policy.settings),
        settings,
      );
      const owner = worktreeOwner(members);
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      const entry: StorageCleanupReportEntry = {
        kind: "worktree",
        outcome: "kept",
        reason: "",
        path: worktreePath,
        projectPath: project?.workspaceRoot ?? null,
        threadId: thread.id,
        threadTitle: thread.title,
        bytes: null,
        files: null,
      };
      const keep = (reason: string) => {
        if (deletionCleanup && settings.worktreeOnDelete) kept.push(worktreePath);
        entries.push({ ...entry, reason: sentence(reason) });
      };
      // Reasons a provider session stop or finished deletion work can clear.
      const waitForStop = (reason: string) => {
        if (deletionCleanup && settings.worktreeOnDelete) waiting = true;
        return reason;
      };
      let phase: ForkWorktreeCleanupProgress["phase"] = "check";
      yield* noteProgress({ worktreePath, state: "checking", phase, reason: null });
      yield* Effect.gen(function* () {
        if (!(yield* fs.exists(worktreePath))) return;
        if (deletionCleanup && !policies.every((policy) => policy.settings.worktreeOnDelete))
          return keep("no rules apply");
        if (deleted && group.length > 0 && owner !== thread)
          return keep("still used by independent threads");
        if (policies.some((policy) => !worktreeCleanupEnabled(policy.settings)))
          return keep("automatic cleanup is off for an associated project");
        if (project === undefined) return keep("project is unavailable");
        if (!group.every((member) => storageCleanupThreadIdle(member, now, serverSettings)))
          return keep(waitForStop("thread is running or has pending work"));
        if (hasTerminal(worktreePath)) return keep(waitForStop("open terminal"));
        if (
          [...group, ...settlementChain].some(
            (member) =>
              member.settledAt !== null &&
              now - Math.max(DateTime.toEpochMillis(member.updatedAt), activityAt) <
                SETTLE_SCRIPT_GRACE_MS,
          )
        )
          return keep(waitForStop("settled moments ago"));
        const settledFor =
          deletionCleanup || clocks.settledAt === null ? null : now - clocks.settledAt;
        const settledDays = settledFor === null ? null : Math.floor(settledFor / DAY_MS);
        const eligibility = policies.map((policy) => {
          const old =
            !deleted &&
            policy.settings.worktreeAfterDays !== null &&
            activityAt < now - policy.settings.worktreeAfterDays * DAY_MS;
          const settled =
            settledFor !== null &&
            policy.settings.worktreeSettledAfterDays !== null &&
            settledFor >= policy.settings.worktreeSettledAfterDays * DAY_MS;
          return { ...policy, old, eligible: deletionCleanup || old || settled };
        });
        let eligible = eligibility.every((policy) => policy.eligible);
        let removalReason = deletionCleanup
          ? "thread was deleted"
          : eligibility.every((policy) => policy.old)
            ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} days`
            : `settled for ${settledDays} days`;
        const blockingSettings =
          eligibility.find((policy) => !policy.eligible)?.settings ?? settings;
        const notDueReason =
          !deleted && blockingSettings.worktreeAfterDays !== null
            ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} of ${blockingSettings.worktreeAfterDays} days`
            : blockingSettings.worktreeSettledAfterDays !== null
              ? settledFor === null
                ? "not settled"
                : `settled for ${settledDays} of ${blockingSettings.worktreeSettledAfterDays} days`
              : blockingSettings.worktreeOnMerge
                ? "not merged"
                : blockingSettings.worktreeUnchanged
                  ? "has commits beyond the default branch"
                  : "no rules apply";
        // Only Git-based rules can make a not-yet-due worktree eligible, so skip Git otherwise.
        if (
          eligibility.some(
            (policy) =>
              !policy.eligible &&
              !policy.settings.worktreeUnchanged &&
              !policy.settings.worktreeOnMerge,
          )
        )
          return keep(notDueReason);
        const pathReason = yield* worktreePathReason(worktreePath);
        if (pathReason !== null) return keep(pathReason);
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects]))
          return keep("contains a project checkout");
        if (yield* repositoryUnavailable(worktreePath)) return keep("repository is unavailable");
        const changes = yield* localChangesReason(worktreePath, localChangesRules);
        if (changes !== null) return keep(changes);
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        if (!eligible && (checkUnchanged || checkMerged)) {
          const repositoryCwd = path.resolve(project.workspaceRoot);
          const remotes = yield* git.execute({
            operation: "StorageCleanup.listRemotes",
            cwd: repositoryCwd,
            args: ["remote"],
          });
          const remote =
            remotes.stdout.trim() === ""
              ? null
              : yield* git.resolvePrimaryRemoteName(repositoryCwd);
          let branch: string | null | undefined;
          let defaultRef: string;
          if (remote === null) {
            if (!checkUnchanged) return keep("no remote is configured for merged-worktree cleanup");
            const projectHead = yield* git.execute({
              operation: "StorageCleanup.resolveProjectBranch",
              cwd: repositoryCwd,
              args: ["symbolic-ref", "--quiet", "HEAD"],
              allowNonZeroExit: true,
            });
            if (projectHead.exitCode !== 0) return keep("project branch is unavailable");
            defaultRef = projectHead.stdout.trim();
            branch = defaultRef.slice("refs/heads/".length);
          } else {
            const defaultBranchKey = `${repositoryCwd}\0${remote}`;
            branch = defaultBranches.get(defaultBranchKey);
            if (branch === undefined) {
              branch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
              // Without a local HEAD ref, only the remote can identify its default;
              // a conventional name may be a feature branch.
              if (branch === null) {
                branch = yield* git
                  .execute({
                    operation: "StorageCleanup.resolveDefaultBranch",
                    cwd: repositoryCwd,
                    args: ["ls-remote", "--symref", "--", remote, "HEAD"],
                    timeoutMs: 20_000,
                  })
                  .pipe(
                    Effect.map(
                      (result) =>
                        /^ref: refs\/heads\/(.+)\tHEAD\r?$/m.exec(result.stdout)?.[1] ?? null,
                    ),
                    Effect.orElseSucceed(() => null),
                  );
              }
              defaultBranches.set(defaultBranchKey, branch);
            }
            if (branch === null) return keep("default branch is unavailable");
            defaultRef = `refs/remotes/${remote}/${branch}`;
            const refreshed = refreshedDefaultRefs.get(repositoryCwd) ?? new Set<string>();
            if (!refreshed.has(defaultRef)) {
              yield* git.fetchRemoteTrackingBranch({
                cwd: repositoryCwd,
                remoteName: remote,
                remoteBranch: branch,
              });
              refreshed.add(defaultRef);
              refreshedDefaultRefs.set(repositoryCwd, refreshed);
            }
          }
          const base = yield* git.resolveCommit({
            cwd: worktreePath,
            revision: defaultRef,
          });
          const ancestor = yield* git.execute({
            operation: "StorageCleanup.integratedBranch",
            cwd: worktreePath,
            args: ["merge-base", "--is-ancestor", head.commitSha, base.commitSha],
            allowNonZeroExit: true,
          });
          const integrated = ancestor.exitCode === 0;
          eligible = eligibility.every(
            (policy) => policy.eligible || (integrated && policy.settings.worktreeUnchanged),
          );
          if (eligible)
            removalReason =
              remote === null
                ? "no commits beyond the project branch"
                : "no commits beyond the default branch";
          if (!eligible && remote !== null && checkMerged) {
            const currentBranch = yield* git.resolveBranchName(worktreePath, "HEAD");
            const pullRequest =
              currentBranch === null
                ? null
                : yield* gitManager.branchPullRequest(
                    { cwd: worktreePath, branch: currentBranch },
                    { refresh: true },
                  );
            const merged =
              currentBranch !== null &&
              storageCleanupPullRequestMerged(pullRequest, {
                branch: currentBranch,
                defaultBranch: branch,
                headSha: head.commitSha,
                integrated,
              });
            eligible = eligibility.every(
              (policy) =>
                policy.eligible ||
                (integrated && policy.settings.worktreeUnchanged) ||
                (merged && policy.settings.worktreeOnMerge),
            );
            if (eligible) removalReason = "pull request was merged";
          }
          if (!eligible && remote === null) return keep("has commits beyond the project branch");
        }
        if (!eligible) return keep(notDueReason);
        // Re-read this path's threads and sessions so new activity cancels removal; full per-worktree snapshots take seconds.
        const blockedSinceCheck = Effect.fnUntraced(function* () {
          const latestProjects = yield* projectStore.listShells();
          if (yield* containsProjectRoot(worktreePath, [project, ...latestProjects]))
            return "contains a project checkout";
          const latest = (yield* projections.getThreadWorktreePaths({
            includeArchived: true,
          })).filter((entry) => path.resolve(entry.worktreePath) === worktreePath);
          if (hasTerminal(worktreePath)) return waitForStop("open terminal");
          if (deletionCleanup) {
            if (
              !resolveWorktreeCleanup(yield* settingsService.getSettings, thread.projectId)
                .worktreeOnDelete
            )
              return "thread or cleanup settings changed since check";
            // Durable deletion cleanup must succeed or be explicitly cancelled before removing its checkout.
            for (const member of [
              ...(deletedByPath.get(worktreePath) ?? []),
              ...deletedAncestors.filter((ancestor) => ancestor !== undefined),
            ]) {
              const pendingCleanup = yield* sql<{ status: string }>`
                SELECT status FROM orchestration_v2_effect_outbox
                WHERE thread_id = ${member.id} AND status NOT IN ('succeeded', 'cancelled')
              `.pipe(NodeSqliteClient.readOnly);
              // Failed effects never retry, so only running work can finish and free the path.
              if (pendingCleanup.some((row) => row.status !== "failed"))
                return waitForStop("thread deletion is still pending");
              if (pendingCleanup.length > 0) return "thread deletion is still pending";
            }
          }
          const latestShells = yield* Effect.forEach(latest, (entry) =>
            projections.getThreadShell(entry.threadId),
          );
          const latestGroup = latestShells.filter((shell) => shell !== null);
          if (
            latestGroup.length !== group.length ||
            latestGroup.some((shell) => {
              const previous = group.find((member) => member.id === shell.id);
              return (
                previous === undefined ||
                shell.branch !== previous.branch ||
                shell.projectId !== previous.projectId ||
                !Equal.equals(shell.lineage, previous.lineage) ||
                !Equal.equals(shell.settledAt, previous.settledAt) ||
                (shell.settledAt !== null && !Equal.equals(shell.updatedAt, previous.updatedAt)) ||
                !storageCleanupThreadIdle(shell, now, serverSettings) ||
                path.resolve(shell.worktreePath!) !== worktreePath ||
                storageCleanupActivityAt(shell) !== storageCleanupActivityAt(previous)
              );
            })
          )
            return waitForStop("thread activity or shared worktree changed since check");
          if (settlementChain.length > 0) {
            const ancestors = yield* Effect.forEach(
              [...new Map(settlementChain.map((member) => [member.id, member])).values()],
              (ancestor) => projections.getThreadShell(ancestor.id),
            );
            const latestFamilyById = new Map(
              [...ancestors.filter((ancestor) => ancestor !== null), ...latestGroup].map(
                (member) => [member.id, member],
              ),
            );
            for (const member of group) {
              const previousSettlement = worktreeSettlementChain(
                member,
                allThreadsById,
                now,
                serverSettings,
              ).at(-1);
              if (previousSettlement === undefined) continue;
              const latestMember = latestFamilyById.get(member.id);
              if (latestMember === undefined) return "parent settlement changed since check";
              const latestSettlement = worktreeSettlementChain(
                latestMember,
                latestFamilyById,
                now,
                serverSettings,
              ).at(-1);
              if (
                latestSettlement?.id !== previousSettlement.id ||
                !Equal.equals(latestSettlement.settledAt, previousSettlement.settledAt) ||
                !Equal.equals(latestSettlement.updatedAt, previousSettlement.updatedAt)
              )
                return "parent settlement changed since check";
            }
          }
          for (const member of group) {
            let ancestor = worktreeParent(member, allThreadsById);
            const visited = new Set<OrchestrationV2ThreadShell["id"]>();
            while (ancestor !== undefined && !visited.has(ancestor.id)) {
              visited.add(ancestor.id);
              if (ancestor.deletedAt === null) {
                const ancestorId = ancestor.id;
                const previousAncestor = liveThreadsById.get(ancestorId);
                const latestAncestor = yield* projections.getThreadShell(ancestor.id);
                if (
                  latestAncestor?.settledAt !== null &&
                  latestAncestor !== null &&
                  now -
                    Math.max(
                      DateTime.toEpochMillis(latestAncestor.updatedAt),
                      storageCleanupActivityAt(latestAncestor),
                    ) <
                    SETTLE_SCRIPT_GRACE_MS
                )
                  return waitForStop("parent settled moments ago");
                if (
                  latestAncestor === null ||
                  previousAncestor === undefined ||
                  !Equal.equals(latestAncestor.settledAt, ancestor.settledAt) ||
                  (ancestor.settledAt !== null &&
                    !Equal.equals(latestAncestor.updatedAt, ancestor.updatedAt)) ||
                  !Equal.equals(latestAncestor.pinnedAt, ancestor.pinnedAt) ||
                  latestAncestor.settledOverride !== ancestor.settledOverride ||
                  !Equal.equals(latestAncestor.lineage, ancestor.lineage) ||
                  storageCleanupActivityAt(latestAncestor) !==
                    storageCleanupActivityAt(previousAncestor) ||
                  !storageCleanupThreadIdle(
                    { ...latestAncestor, worktreePath },
                    now,
                    serverSettings,
                  )
                )
                  return "parent thread changed or has pending work";
              }
              ancestor = worktreeParent(ancestor, allThreadsById);
            }
          }
          // Sessions can outlive their run and can be shared across app threads.
          const sessionRows = yield* sql<{ payload_json: string }>`
            SELECT payload_json FROM orchestration_v2_projection_provider_sessions
            WHERE status != 'stopped'
          `.pipe(NodeSqliteClient.readOnly);
          const sessions = yield* Effect.forEach(sessionRows, (row) =>
            decodeCleanupSession(row.payload_json),
          );
          // Ready persisted sessions may have released their runtime; only live sessions protect the path.
          for (const session of sessions) {
            const cwd = path.resolve(session.cwd);
            if (
              (pathKey(cwd) === pathKey(worktreePath) || inside(worktreePath, cwd)) &&
              (yield* providerSessions.isLive(session.id))
            )
              return waitForStop("provider session is still open");
          }
          return null;
        });
        const blocked = yield* blockedSinceCheck();
        if (blocked !== null) return keep(blocked);
        // Size is an estimate; provider startup must not wait for directory traversal.
        const bytes = yield* measureWorktree(worktreePath);
        yield* withWorkspaceLease(
          worktreePath,
          Effect.gen(function* () {
            const pathReason = yield* worktreePathReason(worktreePath);
            if (pathReason !== null) return keep(pathReason);
            const blockedWhileMeasuring = yield* blockedSinceCheck();
            if (blockedWhileMeasuring !== null) return keep(blockedWhileMeasuring);
            if (yield* repositoryUnavailable(worktreePath))
              return keep("repository is unavailable since check");
            if (
              (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
              head.commitSha
            )
              return keep("commit changed since check");
            const finalChanges = yield* localChangesReason(worktreePath, localChangesRules);
            if (finalChanges !== null) return keep(finalChanges);
            const currentSettings = yield* settingsService.getSettings;
            if (
              currentSettings.autoResumeLimitedThreads !==
                serverSettings.autoResumeLimitedThreads ||
              currentSettings.snoozeLimitedThreads !== serverSettings.snoozeLimitedThreads ||
              policies.some(
                (policy) =>
                  !Equal.equals(
                    resolveWorktreeCleanup(currentSettings, policy.thread.projectId),
                    policy.settings,
                  ),
              )
            )
              return keep("settings changed since check");
            phase = "delete";
            yield* noteProgress({ worktreePath, state: "deleting", phase, reason: null });
            // Clean only untracked files. Ordinary worktrees retain Git's final tracked-edit check.
            if (localChangesRules.worktreeKeepWhen === "tracked-changes")
              yield* cleanupGit(worktreePath, ["clean", "-ffdx"], "git clean");
            const submodules = yield* submoduleRemoval(worktreePath, localChangesRules);
            if (submodules.reason !== null) return keep(submodules.reason);
            if (submodules.force) {
              const changes = yield* localChangesReason(worktreePath, localChangesRules);
              if (changes !== null) return keep(changes);
            }
            yield* removeLinkedWorktree({
              operation: "StorageCleanup.cleanupGit",
              cwd: project.workspaceRoot,
              worktreePath,
              // Git requires force for submodules; recursive checks above cannot make removal atomic.
              force: submodules.force,
              execute: git.execute,
              run: (args) => cleanupGit(project.workspaceRoot, [...args], "git worktree remove"),
            });
            entries.push({ ...entry, outcome: "removed", reason: sentence(removalReason), bytes });
            yield* gitManager.invalidateStatus(project.workspaceRoot);
            // Preserve branch/path so ProviderTurnStartService can recreate the checkout on resume.
            yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id });
          }),
        );
      }).pipe(
        Effect.onInterrupt(() =>
          noteProgress({
            worktreePath,
            state: "failed",
            phase,
            reason: "Cleanup was interrupted. Check the worktree before retrying.",
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* noteProgress({
              worktreePath,
              state: "failed",
              phase,
              reason: cleanupFailureReason(error),
            });
            entries.push({
              ...entry,
              outcome: "failed",
              reason: cleanupFailureReason(error),
            });
            if (deletionCleanup && settings.worktreeOnDelete) kept.push(worktreePath);
            yield* Effect.logWarning("storage cleanup failed for worktree", {
              threadId: thread.id,
              error,
            });
          }),
        ),
      );
      const outcome = entries.findLast((reportEntry) => reportEntry.path === worktreePath);
      if (outcome?.outcome !== "failed")
        yield* noteProgress({
          worktreePath,
          state: outcome?.outcome === "removed" || outcome === undefined ? "removed" : "kept",
          phase,
          reason: outcome?.reason ?? null,
        });
    }
    yield* reportOrphanWorktrees(
      roots,
      yield* projectStore.list({ includeDeleted: true }),
      entries,
    );
    return { waiting, kept };
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
    removed: { files: number; bytes: number },
  ) {
    if (days === null || !(yield* fs.exists(root))) return removed;
    // A symlinked parent (a linked T3 home) is fine; a symlinked folder is not.
    const realRoot = yield* fs.realPath(root);
    const realParent = yield* fs.realPath(path.dirname(root));
    if (realRoot !== path.join(realParent, path.basename(root))) return removed;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
            removed.files++;
            removed.bytes += Number(stat.size);
          }
        }
      }
    });
    yield* visit(realRoot);
    return removed;
  });

  const reportRef = yield* SubscriptionRef.make<StorageCleanupReport | null>(null);
  // Only deleted threads' worktrees wait on session stops: any stop while one waits, or a stop inside one kept for another reason.
  // A deletion stays pending until a sweep that started after it finishes.
  let deletedWorktreeWaits = true;
  let keptDeletedWorktrees: ReadonlyArray<string> = [];
  let deletions = 0;
  let sweptDeletions = 0;
  const sweep = Effect.fn("StorageCleanup.sweep")(function* (
    trigger: StorageCleanupReport["trigger"],
  ) {
    const deletionsAtStart = deletions;
    const now = yield* Clock.currentTimeMillis;
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const entries: StorageCleanupReportEntry[] = [];
    const deletedWorktrees = yield* cleanWorktrees(serverSettings, now, entries).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          entries.push({
            kind: "worktree",
            outcome: "failed",
            reason: cleanupFailureReason(error),
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: null,
            files: null,
          });
          yield* Effect.logWarning("worktree cleanup failed", { error });
          return { waiting: true, kept: [] };
        }),
      ),
    );
    deletedWorktreeWaits = deletedWorktrees.waiting;
    keptDeletedWorktrees = deletedWorktrees.kept;
    sweptDeletions = deletionsAtStart;
    for (const category of [
      {
        kind: "browser-artifacts" as const,
        root: config.browserArtifactsDir,
        days: settings.browserArtifactsAfterDays,
        label: "browser artifacts",
      },
      {
        kind: "logs" as const,
        root: config.logsDir,
        days: settings.logsAfterDays,
        label: "rotated logs",
      },
    ]) {
      if (category.days === null) continue;
      const removed = { files: 0, bytes: 0 };
      yield* cleanFiles(category.root, category.days, now, category.kind === "logs", removed).pipe(
        Effect.map(({ files, bytes }) =>
          entries.push({
            kind: category.kind,
            outcome: files > 0 ? "removed" : "kept",
            reason: files === 0 ? "No expired files" : `Removed ${files} ${category.label}`,
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: files > 0 ? bytes : null,
            files: files > 0 ? files : null,
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            entries.push({
              kind: category.kind,
              outcome: "failed",
              reason: cleanupFailureReason(error),
              path: null,
              projectPath: null,
              threadId: null,
              threadTitle: null,
              bytes: removed.files > 0 ? removed.bytes : null,
              files: removed.files > 0 ? removed.files : null,
            });
            yield* Effect.logWarning("storage file cleanup failed", { kind: category.kind, error });
          }),
        ),
      );
    }
    const counts = { removed: 0, kept: 0, failed: 0 };
    let bytesFreed = 0;
    for (const entry of entries) {
      counts[entry.outcome]++;
      if (entry.outcome !== "kept") bytesFreed += entry.bytes ?? 0;
    }
    const priority = (entry: StorageCleanupReportEntry) =>
      entry.outcome === "failed"
        ? 0
        : entry.outcome === "removed"
          ? 1
          : entry.kind === "worktree" && entry.threadId === null
            ? 2
            : 3;
    const latestReport: StorageCleanupReport = {
      trigger,
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      entries: entries.sort((a, b) => priority(a) - priority(b)).slice(0, REPORT_ENTRY_LIMIT),
      counts,
      bytesFreed,
      omittedCount: Math.max(0, entries.length - REPORT_ENTRY_LIMIT),
    };
    yield* SubscriptionRef.set(reportRef, latestReport);
    return latestReport;
  });
  const automaticSweepQueued = yield* Ref.make(false);
  const worker = yield* makeDrainableWorker(
    (completion: Deferred.Deferred<StorageCleanupReport, ServerSettingsError> | undefined) =>
      (completion === undefined ? Ref.set(automaticSweepQueued, false) : Effect.void).pipe(
        Effect.andThen(sweep(completion === undefined ? "automatic" : "manual")),
        Effect.exit,
        Effect.flatMap((exit) =>
          completion === undefined
            ? exit.pipe(
                Effect.asVoid,
                Effect.catchCause((cause) =>
                  Effect.logWarning("storage cleanup failed", { cause }),
                ),
              )
            : Deferred.done(completion, exit).pipe(Effect.asVoid),
        ),
      ),
  );
  const requestSweep = Ref.getAndSet(automaticSweepQueued, true).pipe(
    Effect.flatMap((queued) => (queued ? Effect.void : worker.enqueue(undefined))),
  );
  const runNow = Effect.gen(function* () {
    const completion = yield* Deferred.make<StorageCleanupReport, ServerSettingsError>();
    yield* worker.enqueue(completion);
    return yield* Deferred.await(completion);
  });

  const start = Effect.fn("StorageCleanup.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = engine.streamDomainEvents;
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* forkParked(
      requestSweep.pipe(
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("1 hour")),
        Effect.asVoid,
      ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return requestSweep;
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) => {
        if (event.type === "thread.deleted") deletions++;
        else if (
          event.type !== "provider-session.updated" ||
          (event.payload.status !== "stopped" && event.payload.status !== "error")
        )
          return Effect.void;
        else if (!deletedWorktreeWaits && deletions === sweptDeletions) {
          const cwd = pathKey(event.payload.cwd);
          if (
            !keptDeletedWorktrees.some(
              (worktreePath) => pathKey(worktreePath) === cwd || inside(worktreePath, cwd),
            )
          )
            return Effect.void;
        }
        if (!anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnDelete)) return Effect.void;
        return event.type === "provider-session.updated" && event.payload.status === "error"
          ? providerSessions
              .isLive(event.payload.id)
              .pipe(Effect.flatMap((live) => (live ? Effect.void : requestSweep)))
          : requestSweep;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Storage cleanup event stream failed", { cause }),
        ),
      ),
    );
  });
  yield* start();
  return StorageCleanup.of({
    getWorktreeActivity,
    getWorktreeCleanupStatus,
    getWorktreeSize,
    runNow,
    latestReport: SubscriptionRef.get(reportRef),
    reports: SubscriptionRef.changes(reportRef),
    trackWorktreeRemoval,
    subscribeWorktreeProgress: (input) => {
      const requestedPaths = new Set(
        input.worktreePaths.map((directory) => path.resolve(directory)),
      );
      return SubscriptionRef.changes(progressRef).pipe(
        Stream.map((progress) => ({
          worktrees: [...progress.values()].filter((entry) =>
            requestedPaths.has(entry.worktreePath),
          ),
        })),
        Stream.changesWith((previous, next) => Equal.equals(previous, next)),
      );
    },
    drain: worker.drain,
  });
});

export const layer = Layer.effect(StorageCleanup, make);
