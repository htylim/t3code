import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as CodexErrors from "effect-codex-app-server/errors";

import { deleteCodexTransientThread } from "./codex.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const root = {
  id: sessionId,
  ephemeral: false,
  source: "appServer",
  status: { type: "notLoaded" },
};

function harness(options?: {
  thread?: unknown;
  children?: (archived: boolean) => unknown;
  failMethod?: string;
}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let deleted = false;
  const client: Parameters<typeof deleteCodexTransientThread>[0] = {
    request: (method, params) =>
      Effect.suspend(() => {
        calls.push({ method, params });
        if (method === options?.failMethod) {
          return Effect.fail(CodexErrors.CodexAppServerRequestError.methodNotFound(method));
        }
        if (method === "thread/read") return Effect.succeed({ thread: options?.thread ?? root });
        if (method === "thread/list") {
          const archived = (params as { archived: boolean }).archived;
          return Effect.succeed(options?.children?.(archived) ?? { data: [], nextCursor: null });
        }
        if (method === "thread/delete") {
          deleted = true;
          return Effect.succeed({});
        }
        return Effect.die(`Unexpected method: ${method}`);
      }),
  };
  return { client, calls, deleted: () => deleted };
}

describe("Codex transient deletion", () => {
  it.effect("deletes only the target after checking active and archived descendants", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* deleteCodexTransientThread(h.client, sessionId);
      assert.isTrue(h.deleted());
      assert.deepEqual(
        h.calls.map((call) => call.method),
        ["thread/read", "thread/list", "thread/list", "thread/delete"],
      );
      for (const [index, archived] of [false, true].entries()) {
        assert.deepInclude(h.calls[index + 1]!.params, {
          ancestorThreadId: sessionId,
          archived,
          modelProviders: [],
          limit: 1,
        });
        assert.include(
          (h.calls[index + 1]!.params as { sourceKinds: string[] }).sourceKinds,
          "subAgentThreadSpawn",
        );
      }
      assert.deepEqual(h.calls.at(-1)?.params, { threadId: sessionId });
    }),
  );

  for (const [name, changes] of [
    ["parent", { parentThreadId: "parent" }],
    ["fork source", { forkedFromId: "source" }],
    ["subagent source", { source: { subAgent: { thread_spawn: { parent_thread_id: "parent" } } } }],
    ["unknown source", { source: "unknown" }],
    ["ephemeral session", { ephemeral: true }],
    ["active session", { status: { type: "active" } }],
    ["broken session", { status: { type: "systemError" } }],
    ["wrong target", { id: "another-thread" }],
  ] as const) {
    it.effect(`rejects a ${name} without deleting`, () =>
      Effect.gen(function* () {
        const h = harness({ thread: { ...root, ...changes } });
        const error = yield* Effect.flip(deleteCodexTransientThread(h.client, sessionId));
        assert.equal(error._tag, "TransientChatProviderThreadDeleteError");
        assert.isFalse(h.deleted());
      }),
    );
  }
  for (const archived of [false, true]) {
    it.effect(`refuses ${archived ? "archived" : "active"} descendants`, () =>
      Effect.gen(function* () {
        const h = harness({
          children: (value) => ({
            data: value === archived ? [{ id: "child" }] : [],
            nextCursor: null,
          }),
        });
        yield* Effect.flip(deleteCodexTransientThread(h.client, sessionId));
        assert.isFalse(h.deleted());
      }),
    );
  }
  for (const children of [{ data: [], nextCursor: "more" }, {}, { data: null, nextCursor: null }]) {
    it.effect(`rejects incomplete descendant metadata: ${JSON.stringify(children)}`, () =>
      Effect.gen(function* () {
        const h = harness({ children: () => children });
        yield* Effect.flip(deleteCodexTransientThread(h.client, sessionId));
        assert.isFalse(h.deleted());
      }),
    );
  }
  for (const failMethod of ["thread/read", "thread/list", "thread/delete"]) {
    it.effect(`propagates ${failMethod} errors without a fallback`, () =>
      Effect.gen(function* () {
        const h = harness({ failMethod });
        const error = yield* Effect.flip(deleteCodexTransientThread(h.client, sessionId));
        assert.equal(error._tag, "CodexAppServerRequestError");
        assert.isFalse(h.deleted());
        assert.notInclude(
          h.calls.map((call) => call.method),
          "thread/archive",
        );
      }),
    );
  }
  it.effect("rejects malformed root metadata before inspecting or deleting children", () =>
    Effect.gen(function* () {
      const h = harness({ thread: { id: sessionId } });
      yield* Effect.flip(deleteCodexTransientThread(h.client, sessionId));
      assert.equal(h.calls.length, 1);
      assert.isFalse(h.deleted());
    }),
  );
});
