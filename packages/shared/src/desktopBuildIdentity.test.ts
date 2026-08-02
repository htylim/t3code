import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_DESKTOP_APP_ID,
  FORK_DESKTOP_APP_ID,
  isForkDesktopVersion,
  resolveDesktopAppId,
} from "./desktopBuildIdentity.ts";

describe("desktopBuildIdentity", () => {
  it.each(["0.0.31-fork", "0.0.31-fork.1", "0.0.31-fork.20260802.1"])(
    "recognizes %s as a fork build",
    (version) => {
      expect(isForkDesktopVersion(version)).toBe(true);
      expect(resolveDesktopAppId(version)).toBe(FORK_DESKTOP_APP_ID);
    },
  );

  it.each(["0.0.31", "0.0.31-nightly.20260802.1", "0.0.31-forked.1"])(
    "keeps %s on the upstream desktop identity",
    (version) => {
      expect(isForkDesktopVersion(version)).toBe(false);
      expect(resolveDesktopAppId(version)).toBe(DEFAULT_DESKTOP_APP_ID);
    },
  );
});
