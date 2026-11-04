import * as Option from "effect/Option";
import type * as Path from "effect/Path";

export type JoinPath = (first: string, ...segments: string[]) => string;

/** Mock updates require an explicit absolute home outside the daily-use T3 directory. */
export function resolveDesktopMockUpdateHome(input: {
  readonly mockUpdates: boolean;
  readonly t3Home: Option.Option<string>;
  readonly homeDirectory: string;
  readonly path: Path.Path;
}): Option.Option<string> {
  if (!input.mockUpdates || Option.isNone(input.t3Home)) return Option.none();
  const configuredHome = input.t3Home.value.trim();
  if (!input.path.isAbsolute(configuredHome)) return Option.none();
  const testHome = input.path.resolve(configuredHome);
  const liveHome = input.path.join(input.homeDirectory, ".t3");
  const relativeHome = input.path.relative(liveHome, testHome);
  if (
    relativeHome === "" ||
    (!relativeHome.startsWith("..") && !input.path.isAbsolute(relativeHome))
  ) {
    return Option.none();
  }
  return Option.some(testHome);
}

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.t3Home), () =>
    input.joinPath(input.homeDirectory, ".t3"),
  );
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
