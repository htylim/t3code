export function isSettingsPathname(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function shouldMountSidebarV2(input: {
  readonly sidebarV2Enabled: boolean;
  readonly pathname: string;
}): boolean {
  return input.sidebarV2Enabled && !isSettingsPathname(input.pathname);
}
