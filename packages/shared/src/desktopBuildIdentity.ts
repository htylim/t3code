export const DEFAULT_DESKTOP_APP_ID = "com.t3tools.t3code";
export const FORK_DESKTOP_APP_ID = "com.htylim.t3code.fork";

const FORK_DESKTOP_VERSION_PATTERN = /-fork(?:\.[0-9A-Za-z-]+)*$/u;

export function isForkDesktopVersion(version: string): boolean {
  return FORK_DESKTOP_VERSION_PATTERN.test(version);
}

export function resolveDesktopAppId(version: string): string {
  return isForkDesktopVersion(version) ? FORK_DESKTOP_APP_ID : DEFAULT_DESKTOP_APP_ID;
}
