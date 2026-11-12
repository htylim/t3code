import type { ScopedProjectRef } from "@t3tools/contracts";

import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { type ThreadId } from "@t3tools/contracts";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironment } from "../state/environments";
import { namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { useProject } from "../state/entities";
import { resolveWorktreeDisplay } from "../worktreeDisplay";

/** Index each project snapshot once, shared by all visible workspace pills. */
const colorIndex = Atom.family((subscription: ReturnType<typeof vcsEnvironment.workspaceColors>) =>
  Atom.map(subscription, (snapshot) => {
    const byThread = new Map<ThreadId, string>();
    const byPath = new Map<string, string>();
    for (const record of AsyncResult.getOrElse(snapshot, () => ({ colors: [] })).colors) {
      byThread.set(record.threadId, record.color);
      byPath.set(record.worktreePath, record.color);
    }
    return { byThread, byPath };
  }),
);
const noColors = Atom.make({
  byThread: new Map<ThreadId, string>(),
  byPath: new Map<string, string>(),
});

/** Resolve a workspace pill using its project's scratch status and saved worktree color. */
export function useWorktreeDisplay(
  projectRef: ScopedProjectRef | null,
  worktreePath: string | null,
  projectCwd?: string | null,
  threadId?: ThreadId,
) {
  const project = useProject(projectRef);
  const environment = useEnvironment(projectRef?.environmentId ?? null);
  const supportsColors =
    environment?.serverConfig?.environment.capabilities.fork?.worktrees?.workspaceColors === true;
  const colors = useAtomValue(
    projectRef && supportsColors
      ? colorIndex(
          vcsEnvironment.workspaceColors({
            environmentId: projectRef.environmentId,
            input: { projectId: projectRef.projectId },
          }),
        )
      : noColors,
  );
  const serverColor =
    (threadId ? colors.byThread.get(threadId) : undefined) ??
    (worktreePath ? colors.byPath.get(worktreePath) : undefined);
  const savedColor = useNamedWorktreeStore((state) =>
    projectRef && worktreePath
      ? state.worktrees[namedWorktreeKey(projectRef, worktreePath)]
      : undefined,
  );
  if (!projectRef || !projectCwd) return null;
  const display = resolveWorktreeDisplay({
    worktreePath,
    projectCwd,
    savedColor: savedColor?.autoPending
      ? (serverColor ?? savedColor.color)
      : (savedColor?.color ?? serverColor),
    isScratchProject: project?.isScratch,
  });
  if (!display) return null;
  let colorMode = savedColor?.colorMode;
  if (!savedColor && serverColor) colorMode = "auto";
  return { ...display, colorMode };
}
