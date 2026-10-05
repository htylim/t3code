import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { ProjectCardState } from "./preferences";

export const PROJECT_CARD_PREVIEW_COUNT = 3;

export interface ProjectCardGroup {
  readonly projectKey: string;
  readonly project: SidebarProjectSnapshot | null;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly timestampMs: number;
}

/** Use the same timestamp as the existing active row's age label. */
export function projectCardThreadTimestampMs(
  thread: Pick<EnvironmentThreadShell, "latestUserMessageAt" | "updatedAt">,
): number {
  const timestampMs = Date.parse(thread.latestUserMessageAt ?? thread.updatedAt);
  return Number.isFinite(timestampMs) ? timestampMs : 0;
}

/** Identify a thread across environments, including when ids overlap. */
export function projectCardThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** Map physical projects through the sidebar's existing grouping preferences. */
export function projectCardProjectByPhysicalKey(projects: readonly SidebarProjectSnapshot[]) {
  const projectByPhysicalKey = new Map<string, SidebarProjectSnapshot>();
  for (const project of projects) {
    for (const member of project.memberProjects) {
      projectByPhysicalKey.set(`${member.environmentId}:${member.id}`, project);
    }
  }
  return projectByPhysicalKey;
}

/** Group eligible threads and sort both levels by the age displayed on their rows. */
export function buildProjectCardGroups(
  projects: readonly SidebarProjectSnapshot[],
  threads: readonly EnvironmentThreadShell[],
): ProjectCardGroup[] {
  const projectByPhysicalKey = projectCardProjectByPhysicalKey(projects);
  const groups = new Map<
    string,
    { project: SidebarProjectSnapshot | null; threads: EnvironmentThreadShell[] }
  >();
  for (const thread of threads) {
    const physicalProjectKey = `${thread.environmentId}:${thread.projectId}`;
    const project = projectByPhysicalKey.get(physicalProjectKey) ?? null;
    const projectKey = project?.projectKey ?? physicalProjectKey;
    let group = groups.get(projectKey);
    if (group === undefined) {
      group = { project, threads: [] };
      groups.set(projectKey, group);
    }
    group.threads.push(thread);
  }
  const cards: ProjectCardGroup[] = [];
  for (const [projectKey, group] of groups) {
    group.threads.sort(
      (left, right) =>
        projectCardThreadTimestampMs(right) - projectCardThreadTimestampMs(left) ||
        projectCardThreadKey(left).localeCompare(projectCardThreadKey(right)),
    );
    cards.push({
      projectKey,
      project: group.project,
      threads: group.threads,
      timestampMs: projectCardThreadTimestampMs(group.threads[0]!),
    });
  }
  return cards.sort(compareProjectCards);
}

/** Keep equal-age projects in a deterministic order. */
export function compareProjectCards(left: ProjectCardGroup, right: ProjectCardGroup): number {
  return right.timestampMs - left.timestampMs || left.projectKey.localeCompare(right.projectKey);
}

/** Reveal a selected older thread alongside the preview without changing saved state. */
export function projectCardVisibleThreads(
  threads: readonly EnvironmentThreadShell[],
  state: ProjectCardState,
  selectedThreadKey: string | null,
  revealSelection: boolean,
): readonly EnvironmentThreadShell[] {
  if (state === "expanded") return threads;
  if (state === "collapsed" && !revealSelection) return [];
  const previewKeys = new Set(
    threads.slice(0, PROJECT_CARD_PREVIEW_COUNT).map(projectCardThreadKey),
  );
  if (revealSelection && selectedThreadKey !== null) previewKeys.add(selectedThreadKey);
  return threads.filter((thread) => previewKeys.has(projectCardThreadKey(thread)));
}
