import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const TRANSIENT_SIDE_CHAT_STORAGE_KEY = "t3code:transient-side-chats:v1";
const TRANSIENT_SIDE_CHAT_STORAGE_VERSION = 1;

interface TransientSideChatState {
  byThreadKey: Record<string, ScopedThreadRef>;
  register: (ref: ScopedThreadRef) => void;
  forget: (ref: ScopedThreadRef) => void;
}

export function migratePersistedTransientSideChats(persistedState: unknown): {
  byThreadKey: Record<string, ScopedThreadRef>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byThreadKey: {} };
  }
  const raw = (persistedState as { byThreadKey?: unknown }).byThreadKey;
  if (!raw || typeof raw !== "object") {
    return { byThreadKey: {} };
  }

  const byThreadKey: Record<string, ScopedThreadRef> = {};
  for (const [threadKey, candidate] of Object.entries(raw)) {
    if (!candidate || typeof candidate !== "object") continue;
    const environmentId = (candidate as { environmentId?: unknown }).environmentId;
    const threadId = (candidate as { threadId?: unknown }).threadId;
    if (typeof environmentId !== "string" || typeof threadId !== "string") continue;
    const ref = {
      environmentId: EnvironmentId.make(environmentId),
      threadId: ThreadId.make(threadId),
    };
    if (scopedThreadKey(ref) !== threadKey) continue;
    byThreadKey[threadKey] = ref;
  }

  return { byThreadKey };
}

export const useTransientSideChatStore = create<TransientSideChatState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      register: (ref) =>
        set((state) => ({
          byThreadKey: {
            ...state.byThreadKey,
            [scopedThreadKey(ref)]: ref,
          },
        })),
      forget: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey)) return state;
          const { [threadKey]: _forgotten, ...byThreadKey } = state.byThreadKey;
          return { byThreadKey };
        }),
    }),
    {
      name: TRANSIENT_SIDE_CHAT_STORAGE_KEY,
      version: TRANSIENT_SIDE_CHAT_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
      migrate: migratePersistedTransientSideChats,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedTransientSideChats(persistedState),
      }),
    },
  ),
);

export function isTransientSideChat(ref: ScopedThreadRef): boolean {
  return isTransientSideChatIn(useTransientSideChatStore.getState().byThreadKey, ref);
}

export function isTransientSideChatIn(
  byThreadKey: Readonly<Record<string, ScopedThreadRef>>,
  ref: ScopedThreadRef,
): boolean {
  return scopedThreadKey(ref) in byThreadKey;
}

export function registerTransientSideChat(ref: ScopedThreadRef): void {
  useTransientSideChatStore.getState().register(ref);
}

export function forgetTransientSideChat(ref: ScopedThreadRef): void {
  useTransientSideChatStore.getState().forget(ref);
}

export function selectStartupTransientSideChats(input: {
  readonly startupThreadKeys: ReadonlySet<string>;
  readonly pendingByThreadKey: Readonly<Record<string, ScopedThreadRef>>;
  readonly connectedEnvironmentIds: ReadonlySet<ScopedThreadRef["environmentId"]>;
  readonly inFlightThreadKeys: ReadonlySet<string>;
}): ReadonlyArray<ScopedThreadRef> {
  return [...input.startupThreadKeys].flatMap((threadKey) => {
    const ref = input.pendingByThreadKey[threadKey];
    return ref &&
      input.connectedEnvironmentIds.has(ref.environmentId) &&
      !input.inFlightThreadKeys.has(threadKey)
      ? [ref]
      : [];
  });
}

export async function deleteTransientSideChat<Result extends { readonly _tag: string }>(
  ref: ScopedThreadRef,
  execute: (input: {
    readonly environmentId: ScopedThreadRef["environmentId"];
    readonly input: { readonly threadId: ScopedThreadRef["threadId"] };
  }) => Promise<Result>,
): Promise<Result> {
  const result = await execute({
    environmentId: ref.environmentId,
    input: { threadId: ref.threadId },
  });
  if (result._tag === "Success") {
    forgetTransientSideChat(ref);
  }
  return result;
}
