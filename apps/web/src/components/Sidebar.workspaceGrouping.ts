import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";

type WorkspaceThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "worktreePath" | "id" | "branch"
>;

/** Describe one thread's part of a shared workspace card. */
export interface SidebarWorkspaceRow {
  readonly position: "first" | "middle" | "last";
  readonly count: number;
  readonly threadKeys: readonly string[];
  readonly branch: string | null;
}

/** Keep physical projects and environments separate, even when their labels match. */
function workspaceGroupKey(thread: WorkspaceThread): string {
  return JSON.stringify([thread.environmentId, thread.projectId, thread.worktreePath]);
}

/** Resolve a card's current visible members without including matching workspaces in other sections. */
export function sidebarWorkspaceCardThreadKeys(input: {
  readonly threadKey: string;
  readonly threadsByKey: ReadonlyMap<string, WorkspaceThread>;
  readonly sectionsByThreadKey: ReadonlyMap<string, string>;
}): string[] {
  const anchorThread = input.threadsByKey.get(input.threadKey);
  const section = input.sectionsByThreadKey.get(input.threadKey);
  if (!anchorThread || section === undefined || section === "settled") return [];
  const groupKey = workspaceGroupKey(anchorThread);
  const threadKeys: string[] = [];
  for (const [threadKey, thread] of input.threadsByKey) {
    if (
      input.sectionsByThreadKey.get(threadKey) === section &&
      workspaceGroupKey(thread) === groupKey
    ) {
      threadKeys.push(threadKey);
    }
  }
  return threadKeys;
}

/** Collect a section's matching workspaces at their first thread, preserving member order. */
export function groupSidebarWorkspaceThreads<Thread extends WorkspaceThread>(
  threads: readonly Thread[],
  enabled: boolean,
): readonly (readonly Thread[])[] {
  if (!enabled) return threads.map((thread) => [thread]);
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    const groupKey = workspaceGroupKey(thread);
    const members = groups.get(groupKey);
    if (members) members.push(thread);
    else groups.set(groupKey, [thread]);
  }
  return Array.from(groups.values());
}

/** Describe only visible multi-thread cards so collapsed shelves retain ordinary single rows. */
export function sidebarWorkspaceRowPositions<Thread extends WorkspaceThread>(
  sections: readonly (readonly Thread[])[],
  enabled: boolean,
): ReadonlyMap<string, SidebarWorkspaceRow> {
  const positions = new Map<string, SidebarWorkspaceRow>();
  if (!enabled) return positions;
  for (const threads of sections) {
    for (const members of groupSidebarWorkspaceThreads(threads, true)) {
      if (members.length < 2) continue;
      const threadKeys = members.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      );
      const branch = members.find((thread) => thread.branch !== null)?.branch ?? null;
      for (const [index, thread] of members.entries()) {
        let position: SidebarWorkspaceRow["position"] = "middle";
        if (index === 0) position = "first";
        if (index === members.length - 1) position = "last";
        positions.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), {
          position,
          count: members.length,
          threadKeys,
          branch,
        });
      }
    }
  }
  return positions;
}
