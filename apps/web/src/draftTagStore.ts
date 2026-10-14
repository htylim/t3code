import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  ThreadTag,
  type EnvironmentId,
  type ScopedThreadRef,
  type ThreadTags,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { DraftId } from "./composerDraftStore";
import { resolveStorage, type StateStorage } from "./lib/storage";

const isThreadTag = Schema.is(ThreadTag);

export interface PendingDraftTag {
  readonly threadRef: ScopedThreadRef;
  readonly tag: ThreadTag;
}

interface DraftTagState {
  readonly byDraftId: Record<string, ThreadTag>;
  readonly pendingByThreadKey: Record<string, PendingDraftTag>;
  /** Select a draft's label and color, or clear both with null. */
  select: (draftId: DraftId, tag: ThreadTag | null) => void;
  /** Persist a send's tag before the request can create its destination thread. */
  stage: (threadRef: ScopedThreadRef, tag: ThreadTag) => void;
  /** Forget only the transfer being completed, preserving a newer request. */
  complete: (pending: PendingDraftTag) => void;
  /** Drop selections belonging to discarded or promoted draft sessions. */
  prune: (draftIds: ReadonlySet<string>) => void;
}

/** Normalize missing colors so the same label and color deduplicate across environments. */
export function draftTagKey(tag: ThreadTag): string {
  return JSON.stringify([tag.label, tag.color?.toLowerCase() ?? null]);
}

/** Collect distinct tags from the visible active inbox, including pinned threads. */
export function collectActiveDraftTags(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly tagsByEnvironment: ReadonlyMap<EnvironmentId, ThreadTags>;
  readonly postponedThreadKeys: ReadonlySet<string>;
  readonly now: string;
}): ThreadTag[] {
  const tagsByKey = new Map<string, ThreadTag>();
  for (const thread of input.threads) {
    const threadKey = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    if (
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.settledOverride === "settled" ||
      input.postponedThreadKeys.has(threadKey) ||
      effectiveSnoozed(thread, { now: input.now })
    )
      continue;
    const tag = input.tagsByEnvironment.get(thread.environmentId)?.[thread.id];
    if (tag)
      tagsByKey.set(draftTagKey(tag), {
        label: tag.label,
        color: tag.color?.toLowerCase() ?? null,
      });
  }
  return [...tagsByKey.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || (left.color ?? "").localeCompare(right.color ?? ""),
  );
}

/** Decode the fork preference independently of upstream's composer storage version. */
export function readPersistedDraftTags(persistedState: unknown) {
  const byDraftId: Record<string, ThreadTag> = {};
  const pendingByThreadKey: Record<string, PendingDraftTag> = {};
  if (persistedState === null || typeof persistedState !== "object")
    return { byDraftId, pendingByThreadKey };
  if (
    "byDraftId" in persistedState &&
    persistedState.byDraftId &&
    typeof persistedState.byDraftId === "object"
  ) {
    for (const [draftId, tag] of Object.entries(persistedState.byDraftId)) {
      if (draftId && isThreadTag(tag)) byDraftId[draftId] = tag;
    }
  }
  if (
    "pendingByThreadKey" in persistedState &&
    persistedState.pendingByThreadKey &&
    typeof persistedState.pendingByThreadKey === "object"
  ) {
    for (const [threadKey, pending] of Object.entries(persistedState.pendingByThreadKey)) {
      const threadRef = parseScopedThreadKey(threadKey);
      if (
        threadRef &&
        pending &&
        typeof pending === "object" &&
        "tag" in pending &&
        isThreadTag(pending.tag)
      ) {
        pendingByThreadKey[threadKey] = { threadRef, tag: pending.tag };
      }
    }
  }
  return { byDraftId, pendingByThreadKey };
}

/** Keep draft selections and unfinished transfers in a separate, synchronously saved fork key. */
export function createDraftTagStore(storage: StateStorage) {
  return create<DraftTagState>()(
    persist(
      (set) => ({
        byDraftId: {},
        pendingByThreadKey: {},
        select: (draftId, tag) =>
          set((state) => {
            const byDraftId = { ...state.byDraftId };
            if (tag) byDraftId[draftId] = { label: tag.label.trim(), color: tag.color ?? null };
            else delete byDraftId[draftId];
            return { byDraftId };
          }),
        stage: (threadRef, tag) =>
          set((state) => ({
            pendingByThreadKey: {
              ...state.pendingByThreadKey,
              [scopedThreadKey(threadRef)]: { threadRef, tag },
            },
          })),
        complete: (pending) =>
          set((state) => {
            const threadKey = scopedThreadKey(pending.threadRef);
            if (state.pendingByThreadKey[threadKey] !== pending) return state;
            const pendingByThreadKey = { ...state.pendingByThreadKey };
            delete pendingByThreadKey[threadKey];
            return { pendingByThreadKey };
          }),
        prune: (draftIds) =>
          set((state) => {
            const byDraftId = { ...state.byDraftId };
            let changed = false;
            for (const draftId of Object.keys(byDraftId)) {
              if (draftIds.has(draftId)) continue;
              delete byDraftId[draftId];
              changed = true;
            }
            return changed ? { byDraftId } : state;
          }),
      }),
      {
        name: "t3code:fork:draft-tags:v1",
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({
          byDraftId: state.byDraftId,
          pendingByThreadKey: state.pendingByThreadKey,
        }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...readPersistedDraftTags(persistedState),
        }),
      },
    ),
  );
}

export const useDraftTagStore = createDraftTagStore(
  resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
);
