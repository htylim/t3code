import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage, type StateStorage } from "./lib/storage";

/** Snapshot the last user message so sending new work automatically restores a thread. */
export interface PostponedThreadRecord {
  readonly latestUserMessageAt: string | null;
}

interface PostponedThreadState {
  byThreadKey: Record<string, PostponedThreadRecord>;
  shelfExpanded: boolean;
  postpone: (threads: readonly EnvironmentThreadShell[]) => void;
  restore: (threadKeys: readonly string[]) => void;
  /** Put back an Undo snapshot without replacing a newer postponement. */
  reinstate: (threadKey: string, record: PostponedThreadRecord) => void;
  toggleShelf: () => void;
}

/** Validate the separate fork preference without changing server or database state. */
export function readPersistedPostponedThreads(persistedState: unknown) {
  const byThreadKey: Record<string, PostponedThreadRecord> = {};
  let shelfExpanded = false;
  if (persistedState === null || typeof persistedState !== "object") {
    return { byThreadKey, shelfExpanded };
  }
  if ("shelfExpanded" in persistedState && typeof persistedState.shelfExpanded === "boolean") {
    shelfExpanded = persistedState.shelfExpanded;
  }
  if (!("byThreadKey" in persistedState)) return { byThreadKey, shelfExpanded };
  const persistedThreads = persistedState.byThreadKey;
  if (persistedThreads === null || typeof persistedThreads !== "object") {
    return { byThreadKey, shelfExpanded };
  }
  for (const [threadKey, record] of Object.entries(persistedThreads)) {
    if (parseScopedThreadKey(threadKey) === null) continue;
    if (record === null || typeof record !== "object" || !("latestUserMessageAt" in record))
      continue;
    const latestUserMessageAt = record.latestUserMessageAt;
    if (latestUserMessageAt !== null && typeof latestUserMessageAt !== "string") continue;
    if (latestUserMessageAt !== null && !Number.isFinite(Date.parse(latestUserMessageAt))) continue;
    byThreadKey[threadKey] = { latestUserMessageAt };
  }
  return { byThreadKey, shelfExpanded };
}

/** Create client-local postponement storage. Inject storage to verify restart behavior. */
export function createPostponedThreadStore(storage: StateStorage) {
  return create<PostponedThreadState>()(
    persist(
      (set, get) => ({
        byThreadKey: {},
        shelfExpanded: false,
        postpone: (threads) =>
          set((state) => {
            const byThreadKey = { ...state.byThreadKey };
            for (const thread of threads) {
              const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              byThreadKey[threadKey] ??= { latestUserMessageAt: thread.latestUserMessageAt };
            }
            return { byThreadKey };
          }),
        restore: (threadKeys) => {
          const state = get();
          // Shared actions also run on ordinary threads. Avoid writing their unchanged preference.
          if (threadKeys.every((threadKey) => state.byThreadKey[threadKey] === undefined)) return;
          const byThreadKey = { ...state.byThreadKey };
          for (const threadKey of threadKeys) delete byThreadKey[threadKey];
          set({ byThreadKey });
        },
        reinstate: (threadKey, record) =>
          set((state) => ({
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: state.byThreadKey[threadKey] ?? record,
            },
          })),
        toggleShelf: () => set((state) => ({ shelfExpanded: !state.shelfExpanded })),
      }),
      {
        name: "t3code:fork:postponed-threads:v1",
        storage: createJSONStorage(() => storage),
        partialize: (state) => ({
          byThreadKey: state.byThreadKey,
          shelfExpanded: state.shelfExpanded,
        }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...readPersistedPostponedThreads(persistedState),
        }),
      },
    ),
  );
}

export const usePostponedThreadStore = createPostponedThreadStore(
  resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
);

/** Postponed cards still offer Settle even after automatic settlement on the server. */
export function isThreadSettledForActions(
  settledOverride: EnvironmentThreadShell["settledOverride"] | undefined,
  isPostponed: boolean,
): boolean {
  return settledOverride === "settled" && !isPostponed;
}

/** Select only new user sends. Completions, failures and attention requests never restore work. */
export function resumedPostponedThreadKeys(
  threads: readonly EnvironmentThreadShell[],
  byThreadKey: Readonly<Record<string, PostponedThreadRecord>>,
): string[] {
  const resumedThreadKeys: string[] = [];
  for (const thread of threads) {
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const postponed = byThreadKey[threadKey];
    if (!postponed || thread.latestUserMessageAt === null) continue;
    if (
      postponed.latestUserMessageAt === null ||
      Date.parse(thread.latestUserMessageAt) > Date.parse(postponed.latestUserMessageAt)
    ) {
      resumedThreadKeys.push(threadKey);
    }
  }
  return resumedThreadKeys;
}
