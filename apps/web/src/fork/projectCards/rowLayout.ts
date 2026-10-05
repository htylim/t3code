/** Optional presentation within a project card; standalone remains the upstream default. */
export type SidebarRowLayout = "standalone" | "project";

// Keep fork dimensions outside the original row classes. The intrinsic estimate matches
// the two-line content height, so off-screen rows preserve their scroll positions.
export const PROJECT_THREAD_ROW_CLASS_NAME =
  "list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_56px]";
export const PROJECT_THREAD_CONTENT_CLASS_NAME =
  "relative z-10 h-14 px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)";
export const PROJECT_DRAFT_CONTENT_CLASS_NAME =
  "relative z-10 flex h-11 items-center px-(--sidebar-row-content-inset) py-(--sidebar-content-inset)";
export const PROJECT_DRAFT_PRIMARY_LINE_CLASS_NAME = "flex h-5 w-full min-w-0 items-center gap-1.5";
export const PROJECT_DRAFT_TITLE_CLASS_NAME =
  "min-w-0 flex-1 truncate text-sm font-medium text-foreground/90";
