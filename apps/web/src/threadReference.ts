import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { activeThreadAnchorTimestampMs } from "@t3tools/client-runtime/state/thread-sort";

export const THREAD_REFERENCE_RESULT_LIMIT = 20;

export interface BuildThreadReferenceOptions {
  readonly environmentId: EnvironmentId;
  readonly currentThreadId: ThreadId | null;
  /** Null means there is no selected project; environment scope is explicit. */
  readonly projectId: ProjectId | null;
  readonly scope: "project" | "environment";
  readonly query: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}

export interface ThreadReferenceItem {
  readonly threadRef: ScopedThreadRef;
  readonly label: string;
  readonly description: string;
}

export interface ThreadReferenceMarkdownToken {
  readonly threadRef: ScopedThreadRef;
  readonly label: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

const MAX_THREAD_REFERENCE_LABEL_LENGTH = 512;
const THREAD_REFERENCE_MARKDOWN_REGEX = new RegExp(
  `\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_THREAD_REFERENCE_LABEL_LENGTH}})\\]\\((t3code:\\/\\/threads\\/[^)\\s]+)\\)`,
  "g",
);

function escapeMarkdownLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function serializeThreadReferenceUri(threadRef: ScopedThreadRef): string {
  return `t3code://threads/${encodeURIComponent(threadRef.environmentId)}/${encodeURIComponent(threadRef.threadId)}`;
}

export function serializeThreadReferenceMarkdown(
  label: string,
  threadRef: ScopedThreadRef,
): string {
  return `[${escapeMarkdownLabel(label)}](${serializeThreadReferenceUri(threadRef)})`;
}

export function parseThreadReferenceUri(destination: string): ScopedThreadRef | null {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }

  if (
    url.protocol !== "t3code:" ||
    url.host !== "threads" ||
    url.hostname !== "threads" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  const encodedSegments = url.pathname.slice(1).split("/");
  if (encodedSegments.length !== 2 || encodedSegments.some((segment) => segment.length === 0)) {
    return null;
  }

  let environmentId: string;
  let threadId: string;
  try {
    environmentId = decodeURIComponent(encodedSegments[0] ?? "");
    threadId = decodeURIComponent(encodedSegments[1] ?? "");
  } catch {
    return null;
  }

  if (environmentId.trim().length === 0 || threadId.trim().length === 0) {
    return null;
  }

  const threadRef = {
    environmentId: environmentId as EnvironmentId,
    threadId: threadId as ThreadId,
  };
  return serializeThreadReferenceUri(threadRef) === destination ? threadRef : null;
}

export function collectThreadReferenceMarkdownTokens(text: string): ThreadReferenceMarkdownToken[] {
  const tokens: ThreadReferenceMarkdownToken[] = [];

  for (const match of text.matchAll(THREAD_REFERENCE_MARKDOWN_REGEX)) {
    const source = match[0];
    const label = (match[1] ?? "").replace(/\\(.)/g, "$1");
    const destination = match[2] ?? "";
    const threadRef = parseThreadReferenceUri(destination);
    if (!threadRef || serializeThreadReferenceMarkdown(label, threadRef) !== source) {
      continue;
    }
    const start = match.index ?? 0;
    tokens.push({
      threadRef,
      label,
      source,
      start,
      end: start + source.length,
    });
  }

  return tokens;
}

function compareAscending(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function buildThreadReferenceItems(
  options: BuildThreadReferenceOptions,
): ThreadReferenceItem[] {
  const projectsById = new Map(
    options.projects
      .filter((project) => project.environmentId === options.environmentId)
      .map((project) => [project.id, project] as const),
  );
  const query = options.query.trim().toLowerCase();

  return options.threads
    .filter(
      (thread) =>
        thread.environmentId === options.environmentId &&
        (options.scope === "environment" || thread.projectId === options.projectId) &&
        thread.archivedAt === null &&
        thread.id !== options.currentThreadId,
    )
    .filter((thread) => {
      if (query.length === 0) return true;
      const project = projectsById.get(thread.projectId);
      return [thread.title, thread.id, project?.title ?? "", thread.branch ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      );
    })
    .sort(
      (left, right) =>
        activeThreadAnchorTimestampMs(right) - activeThreadAnchorTimestampMs(left) ||
        compareAscending(left.id, right.id),
    )
    .slice(0, THREAD_REFERENCE_RESULT_LIMIT)
    .map((thread) => {
      const projectLabel = projectsById.get(thread.projectId)?.title ?? thread.projectId;
      return {
        threadRef: {
          environmentId: thread.environmentId,
          threadId: thread.id,
        },
        label: thread.title,
        description: `${projectLabel}${thread.branch ? ` #${thread.branch}` : ""}`,
      };
    });
}
