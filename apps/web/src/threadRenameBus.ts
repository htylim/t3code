"use client";

import type { ScopedThreadRef } from "@t3tools/contracts";

type ThreadRenameListener = (threadRef: ScopedThreadRef) => void;

const listeners = new Set<ThreadRenameListener>();

export function requestThreadRename(threadRef: ScopedThreadRef): void {
  for (const listener of listeners) {
    listener(threadRef);
  }
}

export function subscribeThreadRename(listener: ThreadRenameListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
