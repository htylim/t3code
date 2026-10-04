import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { ComposerThreadItem } from "@t3tools/client-runtime/composerThreadItems";

import type { Project, ThreadShell } from "./types";

const THREAD_PICKER_RESULT_LIMIT = 20;

type ThreadPickerShell = Pick<
  ThreadShell,
  | "environmentId"
  | "id"
  | "projectId"
  | "title"
  | "branch"
  | "archivedAt"
  | "createdAt"
  | "latestUserMessageAt"
>;

/** Browse loaded thread shells for % or %%, returning upstream context-menu items. */
export function buildComposerThreadPickerItems(input: {
  shells: ReadonlyArray<ThreadPickerShell>;
  projects: ReadonlyArray<Pick<Project, "environmentId" | "id" | "title">>;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  excludeThreadId: ThreadId | null;
  scope: "project" | "environment";
  query: string;
}): ComposerThreadItem[] {
  const projectsById = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project]),
  );
  const query = input.query.trim().toLowerCase();
  return input.shells
    .filter((shell) => {
      if (
        shell.environmentId !== input.environmentId ||
        shell.id === input.excludeThreadId ||
        shell.archivedAt !== null ||
        (input.scope === "project" && shell.projectId !== input.projectId)
      ) {
        return false;
      }
      const projectTitle = projectsById.get(shell.projectId)?.title ?? "";
      return [shell.title, shell.id, shell.branch ?? "", projectTitle].some((searchText) =>
        searchText.toLowerCase().includes(query),
      );
    })
    .sort((left, right) => {
      const leftActivity = left.latestUserMessageAt ?? left.createdAt;
      const rightActivity = right.latestUserMessageAt ?? right.createdAt;
      return rightActivity.localeCompare(leftActivity) || left.id.localeCompare(right.id);
    })
    .slice(0, THREAD_PICKER_RESULT_LIMIT)
    .map((shell) => {
      const projectTitle = projectsById.get(shell.projectId)?.title ?? shell.projectId;
      return {
        id: `thread:${shell.environmentId}:${shell.id}`,
        type: "thread",
        thread: { environmentId: shell.environmentId, threadId: shell.id },
        label: shell.title,
        description: shell.branch ? `${projectTitle} #${shell.branch}` : projectTitle,
      };
    });
}
