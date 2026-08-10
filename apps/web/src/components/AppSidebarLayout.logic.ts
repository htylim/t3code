export function isSettingsPathname(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function shouldMountDefaultSidebar(input: {
  readonly legacySidebarEnabled: boolean;
  readonly pathname: string;
}): boolean {
  return !input.legacySidebarEnabled && !isSettingsPathname(input.pathname);
}
