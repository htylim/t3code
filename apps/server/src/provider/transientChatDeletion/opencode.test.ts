import { assert, describe, it } from "@effect/vitest";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { deleteOpenCodeTransientThread } from "./opencode.ts";

const sessionId = "ses_transient";
const directory = "/projects/transient";

function harness(options?: {
  session?: unknown;
  children?: unknown;
  status?: unknown;
  failPath?: string;
  failStatus?: number;
  deleteFails?: boolean;
  keepSession?: boolean;
  verificationStatus?: number;
}) {
  const sessions = new Set([sessionId, "ses_unrelated"]);
  const calls: Array<{ method: string; path: string; directory: string | null }> = [];
  let attempted = false;
  const client = createOpencodeClient({
    baseUrl: "http://opencode.test",
    fetch: Object.assign(
      async (input: string | Request | URL) => {
        const request = input instanceof Request ? input : new Request(input.toString());
        const url = new URL(request.url);
        const path = url.pathname;
        calls.push({ method: request.method, path, directory: url.searchParams.get("directory") });
        if (path === options?.failPath && !attempted)
          return Response.json({ error: "failed" }, { status: options.failStatus ?? 500 });
        if (request.method === "DELETE") {
          attempted = true;
          if (options?.deleteFails)
            return Response.json({ error: "delete failed" }, { status: 500 });
          if (!options?.keepSession) sessions.delete(sessionId);
          return Response.json(true);
        }
        if (path.endsWith("/children")) return Response.json(options?.children ?? []);
        if (path.endsWith("/status")) return Response.json(options?.status ?? {});
        if (attempted && options?.verificationStatus)
          return Response.json({}, { status: options.verificationStatus });
        if (sessions.has(sessionId)) return Response.json(options?.session ?? { id: sessionId });
        return Response.json({ name: "NotFoundError" }, { status: 404 });
      },
      { preconnect: () => undefined },
    ),
  });
  return { client, sessions, calls, attempted: () => attempted };
}

describe("OpenCode transient deletion", () => {
  it.effect("deletes and verifies the target while preserving unrelated history", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* deleteOpenCodeTransientThread(h.client, sessionId, directory);
      assert.deepEqual([...h.sessions], ["ses_unrelated"]);
      assert.deepEqual(
        h.calls.map((call) => call.method),
        ["GET", "GET", "GET", "DELETE", "GET"],
      );
      assert.isTrue(h.calls.every((call) => call.directory === directory));
    }),
  );
  for (const [name, options] of [
    ["parent", { session: { id: sessionId, parentID: "ses_parent" } }],
    ["wrong session", { session: { id: "ses_other" } }],
    ["child", { children: [{ id: "ses_child" }] }],
    ["busy session", { status: { [sessionId]: { type: "busy" } } }],
    ["retrying session", { status: { [sessionId]: { type: "retry" } } }],
    ["malformed session", { session: {} }],
    ["malformed children", { children: {} }],
    ["malformed status", { status: { [sessionId]: {} } }],
  ] as const) {
    it.effect(`rejects a ${name} without deleting`, () =>
      Effect.gen(function* () {
        const h = harness(options);
        yield* Effect.flip(deleteOpenCodeTransientThread(h.client, sessionId, directory));
        assert.isFalse(h.attempted());
        assert.equal(h.sessions.size, 2);
      }),
    );
  }
  for (const failPath of [
    `/session/${sessionId}`,
    `/session/${sessionId}/children`,
    "/session/status",
  ]) {
    it.effect(`fails closed when ${failPath} is unavailable`, () =>
      Effect.gen(function* () {
        const h = harness({ failPath });
        yield* Effect.flip(deleteOpenCodeTransientThread(h.client, sessionId, directory));
        assert.isFalse(h.attempted());
      }),
    );
  }
  it.effect("reports a missing target without issuing DELETE", () =>
    Effect.gen(function* () {
      const h = harness({ failPath: `/session/${sessionId}`, failStatus: 404 });
      yield* Effect.flip(deleteOpenCodeTransientThread(h.client, sessionId, directory));
      assert.isFalse(h.attempted());
    }),
  );
  for (const options of [
    { deleteFails: true },
    { keepSession: true },
    { verificationStatus: 401 },
    { verificationStatus: 500 },
  ]) {
    it.effect(`does not report false success: ${JSON.stringify(options)}`, () =>
      Effect.gen(function* () {
        const h = harness(options);
        yield* Effect.flip(deleteOpenCodeTransientThread(h.client, sessionId, directory));
        assert.isTrue(h.attempted());
        assert.isTrue(h.sessions.has("ses_unrelated"));
      }),
    );
  }
  it.effect("accepts idle status", () =>
    Effect.gen(function* () {
      const h = harness({ status: { [sessionId]: { type: "idle" } } });
      yield* deleteOpenCodeTransientThread(h.client, sessionId, directory);
      assert.isFalse(h.sessions.has(sessionId));
    }),
  );
  it.effect("interrupting a pending read aborts the HTTP request and never deletes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const aborted = yield* Deferred.make<void>();
      const calls: string[] = [];
      const client = createOpencodeClient({
        baseUrl: "http://opencode.test",
        fetch: Object.assign(
          (input: string | Request | URL) => {
            const request = input instanceof Request ? input : new Request(input.toString());
            calls.push(request.method);
            return new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener(
                "abort",
                () => {
                  Deferred.doneUnsafe(aborted, Effect.void);
                  reject(request.signal.reason);
                },
                { once: true },
              );
              Deferred.doneUnsafe(started, Effect.void);
            });
          },
          { preconnect: () => undefined },
        ),
      });
      const fiber = yield* deleteOpenCodeTransientThread(client, sessionId, directory).pipe(
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      yield* Deferred.await(aborted);
      assert.deepEqual(calls, ["GET"]);
    }),
  );
});
