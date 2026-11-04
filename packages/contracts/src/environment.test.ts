import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import { supportsForkWorktrees } from "./forkWorktrees.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("requires a recognized fork worktree API without rejecting older or future environments", () => {
    expect(supportsForkWorktrees(decodeDescriptor(descriptor).capabilities)).toBe(false);
    for (const apiVersion of [1, 2]) {
      const decoded = decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, fork: { worktrees: { apiVersion } } },
      });
      expect(supportsForkWorktrees(decoded.capabilities)).toBe(apiVersion === 1);
    }
    const incompatible = decodeDescriptor({
      ...descriptor,
      capabilities: { ...descriptor.capabilities, fork: { worktrees: { apiVersion: "future" } } },
    });
    expect(incompatible.capabilities.fork).toBeUndefined();
    expect(supportsForkWorktrees(incompatible.capabilities)).toBe(false);
  });
  it("decodes old, recognized and future manual installation descriptors", () => {
    expect(decodeDescriptor(descriptor).capabilities.serverInstallation).toBeUndefined();
    for (const installation of [{ kind: "npx" }, { kind: "npm-global", prefix: "/opt/node" }]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toEqual(installation);
    }
    for (const installation of [{ kind: "future-manager" }, { kind: "npm-global" }]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toBeUndefined();
    }
  });
});
