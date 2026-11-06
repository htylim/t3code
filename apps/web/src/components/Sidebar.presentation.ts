import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  resolveInboxThreadTimestamp,
  resolveWorkingThreadTimestamp,
} from "@t3tools/client-runtime/state/thread-inbox";
import {
  activeThreadAnchorTimestampMs,
  compareActiveThreadOrder,
  resolveSettledThreadTimestamp,
  sortPinnedThreadsByOrderKey,
  toSortableTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import { formatRelativeElapsed } from "../timestampFormat";

const recencyBrand = Symbol("SidebarRecency");

/** A resolved clock without access to the thread's competing timestamps. */
export interface SidebarRecency {
  readonly [recencyBrand]: true;
  readonly timestamp: number | null;
  readonly description: string;
}

/** A sidebar row whose sort key is the same recency object its age renderer receives. */
export interface SidebarThreadPresentation {
  readonly thread: EnvironmentThreadShell;
  readonly recency: SidebarRecency;
}

export type SidebarThreadOrder =
  | {
      readonly kind: "inbox";
      readonly returnedAt: (thread: EnvironmentThreadShell) => number | undefined;
    }
  | { readonly kind: "sent" | "active" | "pinned" | "snoozed" | "settled" };

// Stable shells retain stable row props when another thread changes.
const presentationCache = new WeakMap<
  EnvironmentThreadShell,
  Map<SidebarThreadOrder["kind"], SidebarThreadPresentation>
>();

/** Choose a section's clock once, before either sorting or rendering its rows. */
function resolveRecency(
  thread: EnvironmentThreadShell,
  order: SidebarThreadOrder,
): Omit<SidebarRecency, typeof recencyBrand> {
  switch (order.kind) {
    case "inbox":
      return {
        timestamp: resolveInboxThreadTimestamp(thread, order.returnedAt(thread)),
        description: "Returned to inbox",
      };
    case "sent":
      return { timestamp: resolveWorkingThreadTimestamp(thread), description: "Last message sent" };
    case "active":
      return {
        timestamp: activeThreadAnchorTimestampMs(thread),
        description: "Active since; manually placed rows keep their position",
      };
    case "pinned":
      return {
        timestamp: toSortableTimestamp(thread.createdAt),
        description: "Created; pinned rows use manual order",
      };
    case "snoozed":
      return {
        timestamp: toSortableTimestamp(thread.snoozedUntil ?? undefined),
        description: "Wakes",
      };
    case "settled":
      return {
        timestamp: toSortableTimestamp(resolveSettledThreadTimestamp(thread) ?? undefined),
        description: "Settled",
      };
  }
}

/** Retain row identity while its shell and resolved clock stay unchanged. */
function presentThread(
  thread: EnvironmentThreadShell,
  order: SidebarThreadOrder,
): SidebarThreadPresentation {
  const recency = resolveRecency(thread, order);
  const cachedByOrder =
    presentationCache.get(thread) ??
    new Map<SidebarThreadOrder["kind"], SidebarThreadPresentation>();
  const previous = cachedByOrder.get(order.kind);
  if (previous !== undefined && previous.recency.timestamp === recency.timestamp) return previous;
  const presentation: SidebarThreadPresentation = {
    thread,
    recency: { [recencyBrand]: true, ...recency },
  };
  cachedByOrder.set(order.kind, presentation);
  presentationCache.set(thread, cachedByOrder);
  return presentation;
}

/** Sort by the very recency object that the row's age component must consume. */
export function presentSidebarThreadSection(
  threads: readonly EnvironmentThreadShell[],
  order: SidebarThreadOrder,
): SidebarThreadPresentation[] {
  const orderedThreads = order.kind === "pinned" ? sortPinnedThreadsByOrderKey(threads) : threads;
  const presentations = orderedThreads.map((thread) => presentThread(thread, order));
  if (order.kind === "pinned") return presentations;
  return presentations.sort((left, right) => {
    const leftTimestamp = left.recency.timestamp ?? 0;
    const rightTimestamp = right.recency.timestamp ?? 0;
    if (order.kind === "active") {
      return compareActiveThreadOrder(left.thread, right.thread, leftTimestamp, rightTimestamp);
    }
    const timestampOrder =
      order.kind === "snoozed" ? leftTimestamp - rightTimestamp : rightTimestamp - leftTimestamp;
    let identityOrder = left.thread.id.localeCompare(right.thread.id);
    if (order.kind === "settled") {
      identityOrder = 0;
      if (left.thread.id < right.thread.id) identityOrder = -1;
      if (left.thread.id > right.thread.id) identityOrder = 1;
    }
    return (
      timestampOrder ||
      identityOrder ||
      left.thread.environmentId.localeCompare(right.thread.environmentId)
    );
  });
}

/** Format the sorted row's clock without accepting another timestamp from the renderer. */
export function formatSidebarRecency(recency: SidebarRecency, nowMs: number): string | null {
  const timestamp = recency.timestamp;
  if (timestamp === null) return null;
  const { value } = formatRelativeElapsed(Math.abs(nowMs - timestamp));
  if (value === "just now") return "now";
  return timestamp > nowMs ? `in ${value}` : value;
}
