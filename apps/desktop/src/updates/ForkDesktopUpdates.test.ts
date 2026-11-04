import { assert, describe, it } from "@effect/vitest";
import { FORK_UPDATE_FEED_URL } from "@t3tools/shared/forkDesktopRelease";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

describe("Fork desktop updates", () => {
  it.effect("checks after startup and continues polling without an explicit user check", () => {
    const harness = makeHarness({
      appVersion: "0.1.0-fork.9",
      processArch: "arm64",
      mockUpdates: true,
      forkManifest: {
        version: "0.1.0-fork.10",
        architectures: ["arm64"],
        releaseNotes: "- Startup check",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.equal(harness.manifestUrls.length, 0);
        yield* TestClock.adjust("15 seconds");
        assert.equal(harness.manifestUrls.length, 1);
        assert.equal((yield* updates.getState).availableVersion, "0.1.0-fork.10");
        yield* TestClock.adjust("4 minutes");
        assert.equal(harness.manifestUrls.length, 2);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("checks and downloads from loopback only in the isolated mock-update session", () => {
    const harness = makeHarness({
      appVersion: "0.1.0-fork.9",
      processArch: "arm64",
      mockUpdates: true,
      forkManifest: {
        version: "0.1.0-fork.10",
        architectures: ["arm64"],
        releaseNotes: "- Local rehearsal",
      },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        yield* updates.check("test");
        assert.isTrue((yield* updates.download).completed);
        assert.deepEqual(harness.manifestUrls, [
          "http://localhost:4141/latest/download/fork-desktop-update.json",
        ]);
        assert.deepEqual(harness.externalUrls, [
          "http://localhost:4141/download/fork-v0.1.0-fork.10/T3-Code-0.1.0-fork.10-arm64.dmg",
        ]);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect.each([
    { processArch: "arm64", translated: false, downloadArchitecture: "arm64" },
    { processArch: "x64", translated: false, downloadArchitecture: "x64" },
    { processArch: "x64", translated: true, downloadArchitecture: "arm64" },
  ])(
    "offers the newer Fork DMG for $processArch with translation=$translated",
    ({ processArch, translated, downloadArchitecture }) => {
      const harness = makeHarness({
        appVersion: "0.1.0-fork.9",
        processArch,
        runningUnderArm64Translation: translated,
        savedChannel: "nightly",
        forkManifest: {
          version: "0.1.0-fork.10",
          architectures: ["arm64", "x64"],
          releaseNotes: "- Fix workspace switching",
        },
      });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          const { state } = yield* updates.check("test");
          assert.equal(state.channel, "latest");
          assert.equal(state.availableVersion, "0.1.0-fork.10");
          assert.isTrue(state.manualDownload);
          assert.equal(state.releaseNotes[0]?.items[0], "Fix workspace switching");
          const download = yield* updates.download;
          assert.isTrue(download.completed);
          assert.equal(download.state.status, "available");
          assert.isNull(download.state.downloadedVersion);
          assert.deepEqual(harness.manifestUrls, [FORK_UPDATE_FEED_URL]);
          assert.deepEqual(harness.externalUrls, [
            `https://github.com/htylim/t3code/releases/download/fork-v0.1.0-fork.10/T3-Code-0.1.0-fork.10-${downloadArchitecture}.dmg`,
          ]);
          assert.isFalse((yield* updates.install).accepted);
          assert.isFalse((yield* updates.installPrepared("0.1.0-fork.10")).accepted);
          assert.equal((yield* updates.setChannel("nightly")).channel, "latest");
          assert.equal(harness.downloadCount(), 0);
          assert.equal(harness.quitAndInstalls(), 0);
        }),
      ).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect.each([
    { version: "0.1.0-fork.8", architectures: ["arm64"] },
    { version: "0.1.0-fork.9", architectures: ["arm64"] },
    { version: "0.1.0-fork.10", architectures: ["x64"] },
    { version: "9.0.0", architectures: ["arm64"] },
    { version: "0.1.0-fork.feature", architectures: ["arm64"] },
  ])("does not offer $version for $architectures", (release) => {
    const harness = makeHarness({
      appVersion: "0.1.0-fork.9",
      processArch: "arm64",
      forkManifest: { ...release, releaseNotes: "" },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        const { state } = yield* updates.check("test");
        assert.isNull(state.availableVersion);
        assert.isFalse((yield* updates.download).accepted);
        assert.deepEqual(harness.externalUrls, []);
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect("reports a failed browser launch without claiming a successful download", () => {
    const harness = makeHarness({
      appVersion: "0.1.0-fork.9",
      processArch: "arm64",
      openDownload: false,
      forkManifest: { version: "0.1.0-fork.10", architectures: ["arm64"], releaseNotes: "" },
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        yield* updates.check("test");
        const download = yield* updates.download;
        assert.isFalse(download.completed);
        assert.equal(download.state.message, "Could not open the update download in your browser.");
      }),
    ).pipe(Effect.provide(harness.layer));
  });

  it.effect.each([{ forkManifest: {} }, { forkHttpStatus: 404 }])(
    "reports an unavailable or malformed feed %#",
    (failure) => {
      const harness = makeHarness({ appVersion: "0.1.0-fork.9", processArch: "arm64", ...failure });
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          assert.equal((yield* updates.check("test")).state.status, "error");
        }),
      ).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect("honors update policy and the environment opt-out", () => {
    const checkDisabled = (harness: ReturnType<typeof makeHarness>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          yield* updates.configure;
          assert.isTrue(Option.isSome(yield* updates.disabledReason));
          assert.isFalse((yield* updates.check("test")).checked);
          assert.deepEqual(harness.manifestUrls, []);
        }),
      ).pipe(Effect.provide(harness.layer));
    return Effect.gen(function* () {
      yield* checkDisabled(
        makeHarness({
          appVersion: "0.1.0-fork.9",
          processArch: "arm64",
          env: { T3CODE_DISABLE_AUTO_UPDATE: "true" },
        }),
      );
      yield* checkDisabled(
        makeHarness({
          appVersion: "0.1.0-fork.9",
          processArch: "arm64",
          policy: {
            mode: "off",
            feedUrl: undefined,
            allowNightly: false,
            message: "Updates disabled by policy.",
          },
        }),
      );
    });
  });
});
