import * as Schema from "effect/Schema";

export const FORK_RELEASE_REPOSITORY = "htylim/t3code";
export const FORK_UPDATE_MANIFEST = "fork-desktop-update.json";
export const FORK_RELEASES_URL = `https://github.com/${FORK_RELEASE_REPOSITORY}/releases`;
export const FORK_UPDATE_FEED_URL = `${FORK_RELEASES_URL}/latest/download/${FORK_UPDATE_MANIFEST}`;

export const ForkDesktopRelease = Schema.Struct({
  version: Schema.String,
  architectures: Schema.Array(Schema.Literals(["arm64", "x64"])),
  releaseNotes: Schema.String,
});

/** Accept the numeric fork release sequence, excluding upstream and feature builds. */
export function isNumericForkRelease(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-fork\.(0|[1-9]\d*)$/u.test(version);
}

/** Match the artifact builder's macOS DMG filename. */
export function forkDesktopDmgName(version: string, architecture: "arm64" | "x64"): string {
  return `T3-Code-${version}-${architecture}.dmg`;
}

/** Point directly at a versioned download so a later release cannot change the offer. */
export function forkDesktopDownloadUrl(
  version: string,
  architecture: "arm64" | "x64",
  releaseBaseUrl = FORK_RELEASES_URL,
): string {
  return `${releaseBaseUrl}/download/fork-v${version}/${forkDesktopDmgName(version, architecture)}`;
}
