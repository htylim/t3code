import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  runWorktreeBulkCleanup,
  summarizeWorktreeBytes,
  worktreeContainsProject,
  worktreeCleanupKey,
  type WorktreeCleanupTarget,
} from "./worktreeBulkCleanup";

/** Keep fixtures scoped to one disposable project. */
function target(name: string): WorktreeCleanupTarget {
  return {
    projectRef: {
      environmentId: EnvironmentId.make("local"),
      projectId: ProjectId.make("project"),
    },
    projectCwd: "/repo",
    path: `/trees/${name}`,
    name,
  };
}

it("protects nested project checkouts without blocking adjacent paths", () => {
  expect(worktreeContainsProject("/trees/review", ["/trees/review/apps/web"])).toBe(true);
  expect(worktreeContainsProject("/trees/review", ["/trees/review-other"])).toBe(false);
  expect(worktreeContainsProject("C:\\Trees\\Review", ["c:/trees/review/apps"])).toBe(true);
  expect(worktreeCleanupKey(target("review"))).not.toBe(
    worktreeCleanupKey({
      ...target("review"),
      projectRef: { ...target("review").projectRef, environmentId: EnvironmentId.make("remote") },
    }),
  );
});

it("counts measured zero-byte worktrees while preserving unknown sizes", () => {
  expect(summarizeWorktreeBytes([1024, null, 2048, 0])).toEqual({
    bytes: 3072,
    knownCount: 3,
    unknownCount: 1,
  });
  expect(summarizeWorktreeBytes([null])).toEqual({ bytes: 0, knownCount: 0, unknownCount: 1 });
});

it("warns about dirty selections before any removal and deduplicates shared worktrees", async () => {
  const clean = target("clean");
  const dirty = target("dirty");
  const remote = {
    ...clean,
    projectRef: { ...clean.projectRef, environmentId: EnvironmentId.make("remote") },
  };
  const events: string[] = [];
  const outcome = await runWorktreeBulkCleanup([clean, dirty, { ...dirty }, remote], {
    inspect: async (worktree) => ({
      target: worktree,
      uncommittedFiles: worktree.name === "dirty" ? 2 : 0,
      reclaimableBytes: worktree.name === "clean" ? null : 4096,
    }),
    confirm: async (inspections) => {
      expect(events).toEqual([]);
      expect(inspections.map((inspection) => inspection.uncommittedFiles)).toEqual([0, 2, 0]);
      expect(inspections.map((inspection) => inspection.reclaimableBytes)).toEqual([
        null,
        4096,
        null,
      ]);
      events.push("confirmed");
      return true;
    },
    remove: async (worktree, force) => {
      events.push(`${worktree.projectRef.environmentId}:${worktree.name}:${force}`);
    },
    onRemoved: () => {},
  });
  expect(events).toEqual([
    "confirmed",
    "local:clean:false",
    "local:dirty:true",
    "remote:clean:false",
  ]);
  expect(outcome.removed).toHaveLength(3);
});

it("cancels the whole batch before deleting anything", async () => {
  let removals = 0;
  const outcome = await runWorktreeBulkCleanup([target("dirty")], {
    inspect: async (worktree) => ({
      target: worktree,
      uncommittedFiles: 1,
      reclaimableBytes: null,
    }),
    confirm: async () => false,
    remove: async () => {
      removals++;
    },
    onRemoved: () => {},
  });
  expect(outcome.cancelled).toBe(true);
  expect(removals).toBe(0);
});

it("deletes nothing when any selection cannot be checked", async () => {
  let confirmations = 0;
  let removals = 0;
  await expect(
    runWorktreeBulkCleanup([target("clean"), target("offline")], {
      inspect: async (worktree) => {
        if (worktree.name === "offline") throw new Error("Environment unavailable");
        return { target: worktree, uncommittedFiles: 0, reclaimableBytes: 0 };
      },
      confirm: async () => {
        confirmations++;
        return true;
      },
      remove: async () => {
        removals++;
      },
      onRemoved: () => {},
    }),
  ).rejects.toThrow("Environment unavailable");
  expect(confirmations).toBe(0);
  expect(removals).toBe(0);
});

it("keeps newly dirty or busy worktrees while removing the rest, without forcing Git failures", async () => {
  const checks = new Map<string, number>();
  const removed: string[] = [];
  const outcome = await runWorktreeBulkCleanup(
    [target("changed"), target("busy"), target("git-refused"), target("clean")],
    {
      inspect: async (worktree) => {
        const count = (checks.get(worktree.name) ?? 0) + 1;
        checks.set(worktree.name, count);
        if (worktree.name === "busy" && count > 1) throw new Error("An agent is running here");
        return {
          target: worktree,
          uncommittedFiles: worktree.name === "changed" && count > 1 ? 1 : 0,
          reclaimableBytes: null,
        };
      },
      confirm: async () => true,
      remove: async (worktree, force) => {
        expect(force).toBe(false);
        if (worktree.name === "git-refused") throw new Error("Worktree is locked");
        removed.push(worktree.name);
      },
      onRemoved: () => {},
    },
  );
  expect(removed).toEqual(["clean"]);
  expect(outcome.failures.map((failure) => failure.target.name)).toEqual([
    "changed",
    "busy",
    "git-refused",
  ]);
});
