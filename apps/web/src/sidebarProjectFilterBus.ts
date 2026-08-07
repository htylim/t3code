"use client";

export type SidebarProjectFilterScope = string | null;
type SidebarProjectFilterListener = (scopeKey: SidebarProjectFilterScope) => void;

const listeners = new Set<SidebarProjectFilterListener>();

export function requestSidebarProjectFilterScope(scopeKey: SidebarProjectFilterScope): void {
  for (const listener of listeners) {
    listener(scopeKey);
  }
}

export function subscribeSidebarProjectFilterScope(
  listener: SidebarProjectFilterListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
