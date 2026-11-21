import {
  CommandId,
  GitCommandError,
  TaskFolderError,
  type ForkWorktreeListInput,
  type ForkWorktreeListResult,
  type ForkWorktreeRenameInput,
  type ForkWorktreeRenameResult,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Path from "effect/Path";

import * as GitWorkflow from "./git/GitWorkflowService.ts";
import * as ThreadManagement from "./orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "./serverSettings.ts";
import { storageCleanupThreadIdle } from "./storageCleanup.ts";
import * as TaskFolders from "./workspace/TaskFolders.ts";

/** Coordinates physical folder moves with the threads that use their checkouts. */
class ForkWorktreeManagement extends Context.Service<
  ForkWorktreeManagement,
  {
    readonly list: (
      input: ForkWorktreeListInput,
    ) => Effect.Effect<ForkWorktreeListResult, GitCommandError>;
    readonly rename: (
      input: ForkWorktreeRenameInput,
    ) => Effect.Effect<ForkWorktreeRenameResult, GitCommandError>;
  }
>()("t3/forkWorktreeManagement") {}

export const make = Effect.gen(function* () {
  const folders = yield* TaskFolders.TaskFolders;
  const git = yield* GitWorkflow.GitWorkflowService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const path = yield* Path.Path;

  /** Keep every saved path at its relative location when a containing folder moves. */
  const rename = Effect.fn("ForkWorktreeManagement.rename")(
    function* (input: ForkWorktreeRenameInput) {
      const folder = yield* folders.find(input.path);
      if (folder === null) return yield* git.renameWorktree(input);
      const belongs = (target: string) => {
        const relative = path.relative(folder.root, target);
        return (
          relative === "" ||
          (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
        );
      };
      let sharing: ReadonlyArray<OrchestrationV2ThreadShell> = [];
      const beforeMove = Effect.gen(function* () {
        const snapshot = yield* threads.getShellSnapshot();
        sharing = [...snapshot.threads, ...snapshot.archivedThreads].filter(
          (thread) => thread.worktreePath !== null && belongs(thread.worktreePath),
        );
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const currentSettings = yield* settings.getSettings;
        if (sharing.some((thread) => !storageCleanupThreadIdle(thread, now, currentSettings)))
          return yield* new TaskFolderError({
            operation: "create",
            detail: "Stop running agents in this task folder before renaming it.",
          });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new TaskFolderError({
              operation: "create",
              detail: "Could not check task-folder activity.",
              cause,
            }),
        ),
      );
      const moved = yield* folders.renameDirectory({
        root: folder.root,
        newDirName: input.newDirName,
        beforeMove,
        onMoved: Effect.fn("ForkWorktreeManagement.updateMovedThreads")(function* (destination) {
          const moveId = yield* randomUuidV4;
          const updated: OrchestrationV2ThreadShell[] = [];
          yield* Effect.forEach(
            sharing,
            (thread) =>
              threads
                .dispatch({
                  type: "thread.metadata.update",
                  commandId: CommandId.make(`worktree-move:${moveId}:${thread.id}`),
                  threadId: thread.id,
                  worktreePath: path.join(
                    destination.root,
                    path.relative(folder.root, thread.worktreePath!),
                  ),
                  expectedWorktreePath: thread.worktreePath,
                })
                .pipe(Effect.tap(() => Effect.sync(() => updated.push(thread)))),
            { discard: true },
          ).pipe(
            Effect.onError(() =>
              Effect.forEach(
                updated,
                (thread) =>
                  threads
                    .dispatch({
                      type: "thread.metadata.update",
                      commandId: CommandId.make(`worktree-move-rollback:${moveId}:${thread.id}`),
                      threadId: thread.id,
                      worktreePath: thread.worktreePath,
                    })
                    .pipe(Effect.ignoreCause({ log: true })),
                { discard: true },
              ),
            ),
            Effect.mapError(
              (cause) =>
                new TaskFolderError({
                  operation: "create",
                  detail: "Could not update the task-folder threads.",
                  cause,
                }),
            ),
          );
        }),
      });
      return { worktree: { path: moved.projectPath, refName: sharing[0]?.branch ?? "HEAD" } };
    },
    Effect.mapError(
      (cause) =>
        new GitCommandError({
          operation: "ForkWorktreeManagement.rename",
          command: "git worktree repair",
          cwd: "worktree",
          detail: cause.message,
          cause,
        }),
    ),
  );
  /** Include task folders even when the project folder itself has no Git repository. */
  const list = Effect.fn("ForkWorktreeManagement.list")(
    function* (input: ForkWorktreeListInput) {
      const refs = yield* git.listRefs({ ...input, worktreesOnly: true });
      const taskFolders = (yield* folders.list).filter(
        (folder) => path.resolve(folder.projectRoot) === path.resolve(input.cwd),
      );
      const combined = new Map(refs.refs.map((ref) => [ref.worktreePath, ref]));
      for (const folder of taskFolders) {
        const checkout = folder.projectIsWorktree
          ? folder.projectPath
          : folder.repositories[0]?.worktreePath;
        if (checkout === undefined) continue;
        const branch = yield* git.currentBranch(checkout).pipe(Effect.orElseSucceed(() => null));
        combined.set(folder.projectPath, {
          name: branch ?? path.basename(folder.root),
          current: false,
          isDefault: false,
          worktreePath: folder.projectPath,
        });
      }
      return { ...refs, refs: [...combined.values()], totalCount: combined.size, taskFolders };
    },
    Effect.mapError(
      (cause) =>
        new GitCommandError({
          operation: "ForkWorktreeManagement.list",
          command: "git worktree list",
          cwd: "worktree",
          detail: cause.message,
          cause,
        }),
    ),
  );
  return ForkWorktreeManagement.of({ rename, list });
});
