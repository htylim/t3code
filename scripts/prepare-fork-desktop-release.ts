#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - This operator CLI sequences native Git and macOS verification tools.
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  FORK_RELEASE_REPOSITORY,
  FORK_UPDATE_MANIFEST,
  forkDesktopDmgName,
  isNumericForkRelease,
} from "@t3tools/shared/forkDesktopRelease";

const hostPlatform = Effect.runSync(HostProcess.Platform);
const repositoryRoot = NodePath.resolve(import.meta.dirname, "..");

/** Run a tool without shell interpolation and fail before preparing a partial release. */
function run(command: string, args: string[], cwd = repositoryRoot): string {
  const execution = NodeChildProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, T3CODE_DESKTOP_SIGNED: "false" },
  });
  if (execution.status !== 0) {
    throw new Error(`${command} failed.\n${execution.stderr}\n${execution.stdout}`, {
      cause: execution.error,
    });
  }
  return execution.stdout.trim();
}

/** Prepare a clean main snapshot and release assets locally. Never tag, push, or publish. */
async function main(): Promise<void> {
  const { values } = NodeUtil.parseArgs({
    options: {
      version: { type: "string" },
      arch: { type: "string", default: "arm64" },
      notes: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: vp run release:fork:prepare --version 0.1.0-fork.N --arch arm64|x64|both --notes /absolute/path/to/notes.md\nBuilds a clean main snapshot in a disposable sibling worktree. Does not publish.\n",
    );
    return;
  }
  const version = values.version;
  if (version === undefined || !isNumericForkRelease(version))
    throw new Error("Use a numeric version such as 0.1.0-fork.24.");
  if (values.arch !== "arm64" && values.arch !== "x64" && values.arch !== "both")
    throw new Error("Choose arm64, x64, or both.");
  if (values.notes === undefined) throw new Error("Supply --notes with the release notes file.");
  if (hostPlatform !== "darwin") throw new Error("Build macOS releases on a Mac.");
  const releaseNotes = await NodeFSP.readFile(NodePath.resolve(values.notes), "utf8");
  if (releaseNotes.trim().length === 0) throw new Error("Release notes must not be empty.");
  const commit = run("git", ["rev-parse", "refs/heads/main"]);
  if (run("git", ["tag", "--list", `fork-v${version}`]))
    throw new Error("This release tag already exists. Choose a new version.");
  const architectures: ReadonlyArray<"arm64" | "x64"> =
    values.arch === "both" ? (["arm64", "x64"] as const) : [values.arch];
  const outputDirectory = NodePath.join(repositoryRoot, "release", `fork-v${version}`);
  await NodeFSP.mkdir(NodePath.dirname(outputDirectory), { recursive: true });
  await NodeFSP.mkdir(outputDirectory, { recursive: false });
  const buildDirectory = NodePath.join(
    NodePath.dirname(repositoryRoot),
    `${NodePath.basename(repositoryRoot)}-release-${version}`,
  );
  run("git", ["worktree", "add", "--detach", buildDirectory, commit]);
  const checksums: string[] = [];
  const checksumFileName = `SHA256SUMS-${version}.txt`;
  try {
    run("vp", ["i", "--frozen-lockfile"], buildDirectory);
    for (const architecture of architectures) {
      process.stdout.write(`Building ${version} for ${architecture} from main at ${commit}\n`);
      run(
        "vp",
        [
          "run",
          `dist:desktop:dmg:${architecture}`,
          "--build-version",
          version,
          "--output-dir",
          outputDirectory,
        ],
        buildDirectory,
      );
      const serverVersion = run("node", ["apps/server/dist/bin.mjs", "--version"], buildDirectory);
      if (serverVersion !== `t3 v${version}`)
        throw new Error("The bundled server version does not match the release.");
      run(
        "rg",
        ["--fixed-strings", "--quiet", version, "apps/server/dist/client/assets"],
        buildDirectory,
      );
      const dmgName = forkDesktopDmgName(version, architecture);
      run("hdiutil", ["verify", NodePath.join(outputDirectory, dmgName)]);
      for (const artifactName of [dmgName, dmgName.replace(/\.dmg$/, ".zip")]) {
        const digest = NodeCrypto.createHash("sha256")
          .update(await NodeFSP.readFile(NodePath.join(outputDirectory, artifactName)))
          .digest("hex");
        checksums.push(`${digest}  ${artifactName}`);
      }
    }
    if (run("git", ["status", "--porcelain", "--untracked-files=no"], buildDirectory))
      throw new Error("The build left tracked source changes.");
  } finally {
    run("git", ["worktree", "remove", buildDirectory]);
  }
  await NodeFSP.writeFile(
    NodePath.join(outputDirectory, checksumFileName),
    `${checksums.join("\n")}\n`,
  );
  await NodeFSP.writeFile(
    NodePath.join(outputDirectory, "release-notes.md"),
    `${releaseNotes.trim()}\n\nSource main: ${commit}\nArchitectures: ${architectures.join(", ")}\n\nInstallation: Quit T3 Code (Fork), open the DMG, and drag the app into Applications. This build is ad-hoc signed, without Developer ID or notarization. If macOS blocks it, attempt to open the installed app, click Done, then open System Settings > Privacy & Security > Security > Open Anyway. Authenticate and confirm. If the button is missing, retry opening the app and reopen Privacy & Security. Do not disable Gatekeeper.\n`,
  );
  await NodeFSP.writeFile(
    NodePath.join(outputDirectory, FORK_UPDATE_MANIFEST),
    `${JSON.stringify({ version, architectures, releaseNotes }, null, 2)}\n`,
  );
  process.stdout.write(
    `Prepared ${outputDirectory}\nSource main: ${commit}\nVerify both app bundles using docs/fork/making-fork-releases.md. Publish only when the developer has authorized the stable release.\nPublish tag fork-v${version} at ${commit} to ${FORK_RELEASE_REPOSITORY}. Upload the DMGs, ZIPs, ${checksumFileName}, and ${FORK_UPDATE_MANIFEST}. Use release-notes.md as the release body, mark the release Latest, and do not mark it as a prerelease.\n`,
  );
}

await main();
