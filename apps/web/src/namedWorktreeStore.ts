import type { ScopedProjectRef, ThreadId } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const NamedWorktreeSelection = Schema.Struct({ name: Schema.String, color: Schema.String });
export type NamedWorktreeSelection = typeof NamedWorktreeSelection.Type;
const PersistedNamedWorktrees = Schema.Struct({
  selections: Schema.Record(Schema.String, NamedWorktreeSelection),
  worktrees: Schema.Record(Schema.String, Schema.Struct({ color: Schema.String })),
});
const decodePersistedNamedWorktrees = Schema.decodeUnknownSync(PersistedNamedWorktrees);

interface NamedWorktreeState {
  selections: Record<string, NamedWorktreeSelection>;
  worktrees: Record<string, { color: string }>;
  /** Save a draft choice, or clear it to restore automatic directory naming. */
  select: (
    projectRef: ScopedProjectRef,
    threadId: ThreadId,
    selection: NamedWorktreeSelection | null,
  ) => void;
  /** Bind a pending choice to the actual path once normal provisioning records it. */
  record: (
    projectRef: ScopedProjectRef,
    threads: readonly { id: ThreadId; worktreePath: string | null }[],
  ) => void;
  /** Save the color of an existing named worktree. */
  setColor: (projectRef: ScopedProjectRef, worktreePath: string, color: string) => void;
  /** Keep the saved color when the workspace menu moves a directory. */
  move: (projectRef: ScopedProjectRef, oldPath: string, newPath: string) => void;
  /** Remove the saved color after successful manual removal. */
  forget: (projectRef: ScopedProjectRef, worktreePath: string) => void;
}

/** Scope browser-only metadata to the machine, project, and thread or absolute path. */
export function namedWorktreeKey(projectRef: ScopedProjectRef, threadIdOrPath: string): string {
  return JSON.stringify([projectRef.environmentId, projectRef.projectId, threadIdOrPath]);
}

/** Keep automatic folders out of the reuse list unless a custom color marks them as named. */
export function isNamedWorktree(worktreePath: string, savedColor?: string): boolean {
  if (savedColor) return true;
  const directoryName = worktreePath.split(/[\\/]/).at(-1) ?? worktreePath;
  return !isTemporaryWorktreeBranch(directoryName);
}

/** Keep color outside server state while the ordinary launch owns Git and cleanup. */
export const useNamedWorktreeStore = create<NamedWorktreeState>()(
  persist(
    (set, get) => ({
      selections: {},
      worktrees: {},
      select: (projectRef, threadId, selection) => {
        const key = namedWorktreeKey(projectRef, threadId);
        const current = get().selections[key];
        if (!current && !selection) return;
        if (current?.name === selection?.name && current?.color === selection?.color) return;
        const selections = { ...get().selections };
        if (selection) selections[key] = selection;
        else delete selections[key];
        set({ selections });
      },
      record: (projectRef, threads) => {
        const state = get();
        if (Object.keys(state.selections).length === 0) return;
        let changed = false;
        const selections = { ...state.selections };
        const worktrees = { ...state.worktrees };
        for (const thread of threads) {
          const selectionKey = namedWorktreeKey(projectRef, thread.id);
          const selection = selections[selectionKey];
          if (!selection || !thread.worktreePath) continue;
          // Failed launches and selecting an existing checkout must not claim its color.
          if (thread.worktreePath.split(/[\\/]/).at(-1) !== selection.name) continue;
          worktrees[namedWorktreeKey(projectRef, thread.worktreePath)] = { color: selection.color };
          delete selections[selectionKey];
          changed = true;
        }
        if (changed) set({ selections, worktrees });
      },
      setColor: (projectRef, worktreePath, color) => {
        const key = namedWorktreeKey(projectRef, worktreePath);
        if (get().worktrees[key]?.color === color) return;
        set({ worktrees: { ...get().worktrees, [key]: { color } } });
      },
      move: (projectRef, oldPath, newPath) => {
        const oldKey = namedWorktreeKey(projectRef, oldPath);
        const metadata = get().worktrees[oldKey];
        if (!metadata) return;
        const worktrees = { ...get().worktrees };
        delete worktrees[oldKey];
        worktrees[namedWorktreeKey(projectRef, newPath)] = metadata;
        set({ worktrees });
      },
      forget: (projectRef, worktreePath) => {
        const key = namedWorktreeKey(projectRef, worktreePath);
        if (!get().worktrees[key]) return;
        const worktrees = { ...get().worktrees };
        delete worktrees[key];
        set({ worktrees });
      },
    }),
    {
      name: "t3code:fork:named-worktrees:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      partialize: (state) => ({ selections: state.selections, worktrees: state.worktrees }),
      merge: (persistedState, currentState) => {
        try {
          return {
            ...currentState,
            ...decodePersistedNamedWorktrees(persistedState),
          };
        } catch {
          return currentState;
        }
      },
    },
  ),
);
