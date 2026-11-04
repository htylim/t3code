import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";
import { ForkWorktreeListResult } from "./forkWorktrees.ts";
import { VcsListRefsResult } from "./git.ts";

const decodeUpstreamRefs = Schema.decodeSync(VcsListRefsResult);
const decodeForkWorktrees = Schema.decodeSync(ForkWorktreeListResult);

describe("WebSocket RPC contracts", () => {
  it("isolates fork worktree methods and metadata from upstream contracts", () => {
    for (const method of [
      "fork.worktrees.list",
      "fork.worktrees.size",
      "fork.worktrees.rename",
      "fork.worktrees.activity",
    ]) {
      expect([...WsRpcGroup.requests.keys()]).toContain(method);
    }
    for (const method of ["vcs.worktreeSize", "vcs.renameWorktree"]) {
      expect([...WsRpcGroup.requests.keys()]).not.toContain(method);
    }
    const result = {
      refs: [],
      isRepo: true,
      hasPrimaryRemote: false,
      nextCursor: null,
      totalCount: 0,
      mainWorktreePath: "/repo",
    };
    expect(decodeUpstreamRefs(result)).not.toHaveProperty("mainWorktreePath");
    expect(decodeForkWorktrees(result).mainWorktreePath).toBe("/repo");
  });
  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});
