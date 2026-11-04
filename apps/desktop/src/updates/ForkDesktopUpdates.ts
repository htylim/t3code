import type { DesktopUpdateState } from "@t3tools/contracts";
import {
  FORK_UPDATE_FEED_URL,
  FORK_RELEASES_URL,
  FORK_UPDATE_MANIFEST,
  ForkDesktopRelease,
  forkDesktopDownloadUrl,
  isNumericForkRelease,
} from "@t3tools/shared/forkDesktopRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { errorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import { resolveDesktopMockUpdateHome } from "../app/DesktopStatePaths.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import * as DesktopUpdatePolicy from "./DesktopUpdatePolicy.ts";
import type { DesktopUpdates } from "./DesktopUpdates.ts";
import { normalizeDesktopUpdateReleaseNotes } from "./releaseNotes.ts";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine.ts";

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-fork-updater");

/** Check Fork releases without handing unsigned bundles to Squirrel's installer. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const config = yield* DesktopConfig.DesktopConfig;
  const policy = yield* DesktopUpdatePolicy.DesktopUpdatePolicy;
  const http = yield* HttpClient.HttpClient;
  const shell = yield* ElectronShell.ElectronShell;
  const windows = yield* ElectronWindow.ElectronWindow;
  const mockUpdateHome = resolveDesktopMockUpdateHome({
    mockUpdates: config.mockUpdates,
    t3Home: config.t3Home,
    homeDirectory: environment.homeDirectory,
    path: environment.path,
  });
  const useMockFeed = Option.isSome(mockUpdateHome) && policy.message === null;
  const releaseBaseUrl = useMockFeed
    ? `http://localhost:${config.mockUpdateServerPort}`
    : FORK_RELEASES_URL;
  const feedUrl = useMockFeed
    ? `${releaseBaseUrl}/latest/download/${FORK_UPDATE_MANIFEST}`
    : FORK_UPDATE_FEED_URL;
  /** Keep managed feeds and development sessions out of the public Fork channel. */
  function resolveDisabledReason(): string | null {
    if (policy.mode === "off") return policy.message ?? "Updates are turned off on this machine.";
    if (policy.feedUrl !== undefined) {
      return "Fork DMG updates are unavailable while an administrator configures a custom update feed.";
    }
    if (config.disableAutoUpdate) {
      return "Automatic updates are disabled by the T3CODE_DISABLE_AUTO_UPDATE setting.";
    }
    if (!environment.isPackaged || environment.isDevelopment) {
      return "Fork update checks are only available in packaged production builds.";
    }
    return null;
  }
  const disabledReason = resolveDisabledReason();
  const state = yield* Ref.make<DesktopUpdateState>({
    ...createInitialDesktopUpdateState(environment.appVersion, environment.runtimeInfo, "latest"),
    enabled: disabledReason === null,
    status: disabledReason === null ? "idle" : "disabled",
    message: disabledReason,
    manualDownload: true,
  });
  const changes = yield* PubSub.sliding<DesktopUpdateState>(16);
  const mutex = yield* Semaphore.make(1);
  const active = yield* Ref.make(false);
  const configured = yield* Ref.make(false);
  const emitState = Ref.get(state).pipe(
    Effect.flatMap((snapshot) => windows.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, snapshot)),
  );
  /** Publish each transition atomically with the snapshot subscribers first receive. */
  const publish = Effect.fn("ForkDesktopUpdates.publish")(function* (snapshot: DesktopUpdateState) {
    yield* mutex.withPermits(1)(
      Ref.set(state, snapshot).pipe(Effect.andThen(PubSub.publish(changes, snapshot))),
    );
    yield* emitState;
  });
  /** Fetch a fresh manifest, rejecting downgrades and releases without this Mac's architecture. */
  const check = Effect.fn("ForkDesktopUpdates.check")(function* (_reason: string) {
    if (disabledReason !== null || (yield* Ref.getAndSet(active, true))) {
      return { checked: false, state: yield* Ref.get(state) };
    }
    return yield* Effect.gen(function* () {
      yield* logInfo("checking for Fork updates", { reason: _reason, mockFeed: useMockFeed });
      const previous = yield* Ref.get(state);
      const checkedAt = DateTime.formatIso(yield* DateTime.now);
      yield* publish(reduceDesktopUpdateStateOnCheckStart(previous, checkedAt));
      yield* http.get(feedUrl, { headers: { "Cache-Control": "no-cache" } }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(ForkDesktopRelease)),
        Effect.timeout("15 seconds"),
        Effect.flatMap((release) => {
          if (!isNumericForkRelease(release.version)) {
            return publish(
              reduceDesktopUpdateStateOnCheckFailure(
                previous,
                "The Fork release manifest has an invalid version.",
                checkedAt,
              ),
            );
          }
          const architecture = environment.runtimeInfo.hostArch;
          if (
            (architecture !== "arm64" && architecture !== "x64") ||
            !release.architectures.includes(architecture) ||
            compareSemverVersions(release.version, environment.appVersion) <= 0
          ) {
            return publish(reduceDesktopUpdateStateOnNoUpdate(previous, checkedAt));
          }
          const notes = normalizeDesktopUpdateReleaseNotes(
            release.releaseNotes,
            release.version,
            "latest",
          );
          return publish(
            reduceDesktopUpdateStateOnUpdateAvailable(
              previous,
              release.version,
              checkedAt,
              notes.releaseNotes,
              notes.omittedReleaseCount,
            ),
          );
        }),
        Effect.catch((error) =>
          logWarning("Fork update check failed", { errorTag: errorTag(error) }).pipe(
            Effect.andThen(
              publish(
                reduceDesktopUpdateStateOnCheckFailure(
                  previous,
                  "Could not check for Fork updates. Try again later.",
                  checkedAt,
                ),
              ),
            ),
          ),
        ),
      );
      const checkedState = yield* Ref.get(state);
      yield* logInfo("Fork update check finished", {
        status: checkedState.status,
        availableVersion: checkedState.availableVersion,
      });
      return { checked: true, state: checkedState };
    }).pipe(Effect.ensuring(Ref.set(active, false)));
  });
  /** Launch the offered version's DMG in the browser without claiming it was installed. */
  const download = Effect.gen(function* () {
    if (yield* Ref.getAndSet(active, true)) {
      return { accepted: false, completed: false, state: yield* Ref.get(state) };
    }
    return yield* Effect.gen(function* () {
      const snapshot = yield* Ref.get(state);
      const architecture = environment.runtimeInfo.hostArch;
      if (
        !snapshot.enabled ||
        snapshot.status !== "available" ||
        snapshot.availableVersion === null ||
        (architecture !== "arm64" && architecture !== "x64")
      ) {
        return { accepted: false, completed: false, state: snapshot };
      }
      const opened = yield* shell.openExternal(
        forkDesktopDownloadUrl(snapshot.availableVersion, architecture, releaseBaseUrl),
      );
      const next = {
        ...snapshot,
        message: opened ? null : "Could not open the update download in your browser.",
      };
      yield* publish(next);
      return { accepted: true, completed: opened, state: next };
    }).pipe(Effect.ensuring(Ref.set(active, false)));
  }).pipe(Effect.withSpan("ForkDesktopUpdates.download"));
  const refuseInstall = Ref.get(state).pipe(
    Effect.map((snapshot) => ({ accepted: false, completed: false, state: snapshot })),
  );

  return {
    getState: Ref.get(state),
    isActionActive: Ref.get(active),
    isInstallActive: Effect.succeed(false),
    subscribe: mutex.withPermits(1)(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return { latest: yield* Ref.get(state), changes: Stream.fromSubscription(subscription) };
      }),
    ),
    emitState,
    disabledReason: Effect.succeed(Option.fromNullishOr(disabledReason)),
    configure: Effect.gen(function* () {
      if (yield* Ref.getAndSet(configured, true)) return;
      yield* logInfo("Fork updater configured", {
        currentVersion: environment.appVersion,
        enabled: disabledReason === null,
        disabledReason,
        mockFeed: useMockFeed,
      });
      yield* emitState;
      if (disabledReason !== null) return;
      yield* check("poll").pipe(
        Effect.repeat(Schedule.spaced("4 minutes")),
        Effect.delay("15 seconds"),
        Effect.forkScoped,
      );
    }),
    // Fork has one track; old saved Nightly preferences never select upstream releases.
    setChannel: () => Ref.get(state),
    check,
    download,
    install: refuseInstall,
    installPrepared: () =>
      refuseInstall.pipe(Effect.map((action) => ({ ...action, failed: true }))),
  } satisfies DesktopUpdates["Service"];
});
