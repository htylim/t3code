import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  namedWorktreeKey,
  resolveNamedWorktreeColor,
  useNamedWorktreeStore,
} from "./namedWorktreeStore";

const projectRef = scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("project"));
const threadId = ThreadId.make("draft");
const selection = { name: "billing-fix", color: "#14b8a6" };

beforeEach(() => useNamedWorktreeStore.setState({ selections: {}, worktrees: {} }));

describe("named worktree metadata", () => {
  it("does not persist during ordinary thread updates after recording a color", () => {
    const store = useNamedWorktreeStore.getState();
    const storage = useNamedWorktreeStore.persist.getOptions().storage!;
    const write = vi.spyOn(storage, "setItem");
    try {
      store.record(projectRef, [{ id: threadId, worktreePath: "/worktrees/billing-fix" }]);
      store.select(projectRef, threadId, null);
      expect(write).not.toHaveBeenCalled();
      store.select(projectRef, threadId, selection);
      store.record(projectRef, [{ id: threadId, worktreePath: "/worktrees/billing-fix" }]);
      write.mockClear();
      store.record(projectRef, [{ id: threadId, worktreePath: "/worktrees/billing-fix" }]);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
  it("shows existing named folders across clients and hides automatic folder names", () => {
    expect(resolveNamedWorktreeColor("/worktrees/billing-fix")).toBe("#8b5cf6");
    expect(resolveNamedWorktreeColor("C:\\worktrees\\billing-fix", "#14b8a6")).toBe("#14b8a6");
    expect(resolveNamedWorktreeColor("/worktrees/t3-abcd1234")).toBeNull();
    expect(resolveNamedWorktreeColor("/worktrees/t3code-abcd1234")).toBeNull();
    expect(resolveNamedWorktreeColor("/worktrees/t3-abcd1234", "#14b8a6")).toBe("#14b8a6");
  });
  it("keeps independent choices for different projects and machines", () => {
    const otherMachine = scopeProjectRef(EnvironmentId.make("remote"), projectRef.projectId);
    const otherProject = scopeProjectRef(projectRef.environmentId, ProjectId.make("other"));
    const store = useNamedWorktreeStore.getState();
    store.select(projectRef, threadId, selection);
    store.select(otherMachine, threadId, { name: "remote-fix", color: "#3b82f6" });
    store.select(otherProject, threadId, { name: "other-fix", color: "#f59e0b" });
    expect(Object.keys(useNamedWorktreeStore.getState().selections)).toHaveLength(3);
    store.select(projectRef, threadId, null);
    expect(Object.keys(useNamedWorktreeStore.getState().selections)).toHaveLength(2);
  });

  it("waits for the selected directory before binding its color to the actual path", () => {
    const store = useNamedWorktreeStore.getState();
    store.select(projectRef, threadId, selection);
    store.record(projectRef, [{ id: threadId, worktreePath: null }]);
    store.record(projectRef, [{ id: threadId, worktreePath: "/repo-worktrees/automatic" }]);
    expect(useNamedWorktreeStore.getState().worktrees).toEqual({});
    const worktreePath = "/custom/worktrees/repo/billing-fix";
    store.record(projectRef, [{ id: threadId, worktreePath }]);
    expect(useNamedWorktreeStore.getState().selections).toEqual({});
    expect(useNamedWorktreeStore.getState().worktrees).toEqual({
      [namedWorktreeKey(projectRef, worktreePath)]: { color: selection.color },
    });
    // Another thread can reuse the same directory without owning its color.
    store.record(projectRef, [{ id: ThreadId.make("followup"), worktreePath }]);
    expect(
      useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, worktreePath)]?.color,
    ).toBe(selection.color);
  });

  it("preserves color through a directory rename and removes it after deletion", () => {
    const store = useNamedWorktreeStore.getState();
    const oldPath = "/worktrees/billing-fix";
    const newPath = "/worktrees/billing-v2";
    store.select(projectRef, threadId, selection);
    store.record(projectRef, [{ id: threadId, worktreePath: oldPath }]);
    store.move(projectRef, oldPath, newPath);
    expect(
      useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, oldPath)],
    ).toBeUndefined();
    expect(
      useNamedWorktreeStore.getState().worktrees[namedWorktreeKey(projectRef, newPath)]?.color,
    ).toBe(selection.color);
    store.forget(projectRef, newPath);
    expect(useNamedWorktreeStore.getState().worktrees).toEqual({});
  });

  it("rehydrates pending choices and completed metadata from local storage", async () => {
    const store = useNamedWorktreeStore.getState();
    store.select(projectRef, threadId, selection);
    store.record(projectRef, [{ id: threadId, worktreePath: "/worktrees/billing-fix" }]);
    store.select(projectRef, ThreadId.make("pending"), { name: "next", color: "#3b82f6" });
    const storage = useNamedWorktreeStore.persist.getOptions().storage!;
    const persisted = await storage.getItem("t3code:fork:named-worktrees:v1");
    useNamedWorktreeStore.setState({ selections: {}, worktrees: {} });
    await storage.setItem("t3code:fork:named-worktrees:v1", persisted!);
    await useNamedWorktreeStore.persist.rehydrate();
    expect(Object.values(useNamedWorktreeStore.getState().worktrees)).toEqual([
      { color: selection.color },
    ]);
    expect(Object.values(useNamedWorktreeStore.getState().selections)).toEqual([
      { name: "next", color: "#3b82f6" },
    ]);
  });
});
