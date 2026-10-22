import type { OrchestrationV2ThreadShell, ScopedProjectRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { isNamedWorktree, namedWorktreeKey, useNamedWorktreeStore } from "../namedWorktreeStore";
import { useThreadShellsForProjectRefs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { resolveWorktreeRows } from "../components/BranchToolbar.logic";

/** Share checked-out workspace choices between the composer menu and change dialog. */
export function useWorkspaceChoices(props: {
  projectRef: ScopedProjectRef;
  projectCwd: string;
  activeWorktreePath: string | null;
  activeBranch: string | null;
}) {
  const refsQuery = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId: props.projectRef.environmentId,
      input: { cwd: props.projectCwd, worktreesOnly: true },
    }),
  );
  const refs = refsQuery.data?.refs ?? [];
  const projectRefs = [props.projectRef];
  const liveThreads = useThreadShellsForProjectRefs(projectRefs);
  const archived = useArchivedThreadSnapshots([props.projectRef.environmentId]);
  const threads = (() => {
    const byId = new Map<string, OrchestrationV2ThreadShell>();
    for (const snapshot of archived.snapshots) {
      for (const thread of snapshot.snapshot.threads) {
        if (thread.projectId === props.projectRef.projectId) byId.set(thread.id, thread);
      }
    }
    for (const thread of liveThreads) byId.set(thread.id, thread.source);
    return [...byId.values()];
  })();
  const namedWorktrees = useNamedWorktreeStore((state) => state.worktrees);
  useEffect(() => {
    useNamedWorktreeStore.getState().record(props.projectRef, threads);
  }, [props.projectRef, threads]);
  const rows = resolveWorktreeRows({
    refs,
    threads: threads.map((thread) => ({
      worktreePath: thread.worktreePath,
      archivedAt: thread.archivedAt === null ? null : "archived",
      settledOverride: thread.settledOverride,
      relationshipToParent: thread.lineage.relationshipToParent,
      status: thread.status,
    })),
    activeProjectCwd: props.projectCwd,
    activeWorktreePath: props.activeWorktreePath,
    activeBranch: props.activeBranch,
  }).filter(
    (row) =>
      row.worktreePath === props.activeWorktreePath ||
      isNamedWorktree(
        row.worktreePath,
        namedWorktrees[namedWorktreeKey(props.projectRef, row.worktreePath)]?.color,
      ),
  );
  const localRef = refs.find((ref) => ref.worktreePath === props.projectCwd);
  return { refsQuery, archived, threads, rows, localRef };
}
