"use client";

export type SidebarProjectFilterScope = string | null;
export type SidebarProjectFilterUpdate =
  | SidebarProjectFilterScope
  | ((currentScopeKey: SidebarProjectFilterScope) => SidebarProjectFilterScope);
type SidebarProjectFilterListener = (update: SidebarProjectFilterUpdate) => void;

const listeners = new Set<SidebarProjectFilterListener>();

export function requestSidebarProjectFilterScope(update: SidebarProjectFilterUpdate): void {
  for (const listener of listeners) {
    listener(update);
  }
}

export function requestSidebarProjectFilterScopeIfFiltered(scopeKey: string): void {
  requestSidebarProjectFilterScope((currentScopeKey) =>
    currentScopeKey === null ? null : scopeKey,
  );
}

export function subscribeSidebarProjectFilterScope(
  listener: SidebarProjectFilterListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
