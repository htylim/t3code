import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const environmentId = EnvironmentId.make("environment-1");
const makeFakeHttpServer = (hostname: string, port = 43123) =>
  HttpServer.HttpServer.of({
    address: { _tag: "TcpAddress", hostname, port },
    serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
  });
const fakeHttpServer = makeFakeHttpServer("127.0.0.1");
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});

const makeRegistry = (now: () => number, httpServer = fakeHttpServer) =>
  McpSessionRegistry.__testing
    .make({
      now,
      livenessWindowMs: 100,
    })
    .pipe(
      Effect.provideService(HttpServer.HttpServer, httpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(NodeServices.layer),
    );

it.effect("stores only a token hash, resolves the bearer token, and revokes by thread", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-1");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      browserAccessEnabled: true,
    });
    expect(issued.config.endpoint).toBe("http://127.0.0.1:43123/mcp");
    expect(issued.config.browserToolsAvailable).toBe(true);
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    expect(token.length).toBeGreaterThan(20);

    const resolved = yield* registry.resolve(token);
    expect(resolved?.threadId).toBe(threadId);
    expect(resolved?.capabilities).toEqual(new Set(["preview", "thread-control"]));
    expect(resolved?.maxRuntimeMode).toBe("approval-required");
    expect(resolved?.controlledThreadIds).toEqual(new Set());

    yield* registry.revokeThread(threadId);
    expect(yield* registry.resolve(token)).toBeUndefined();

    timestamp += 2_000;
  }),
);

it.effect("keeps thread control while browser access is disabled", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-browser-disabled"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "auto",
      browserAccessEnabled: false,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    expect(issued.config.browserToolsAvailable).toBe(false);
    expect((yield* registry.resolve(token))?.capabilities).toEqual(new Set(["thread-control"]));
  }),
);

it.effect("builds MCP endpoints from the bound server host", () =>
  Effect.gen(function* () {
    const cases = [
      ["100.64.0.40", "http://100.64.0.40:43123/mcp"],
      ["0.0.0.0", "http://127.0.0.1:43123/mcp"],
      ["localhost", "http://localhost:43123/mcp"],
      ["127.0.0.1", "http://127.0.0.1:43123/mcp"],
    ] as const;

    for (const [hostname, expectedEndpoint] of cases) {
      const registry = yield* makeRegistry(() => 1_000, makeFakeHttpServer(hostname));
      const issued = yield* registry.issue({
        threadId: ThreadId.make(`thread-${hostname}`),
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "auto",
        browserAccessEnabled: true,
      });
      expect(issued.config.endpoint).toBe(expectedEndpoint);
    }
  }),
);

it.effect("expires credentials once their session stops showing signs of life", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-2"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      runtimeMode: "auto",
      browserAccessEnabled: true,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    timestamp += 101;
    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("keeps a credential alive across turns that never touch an MCP tool", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-3");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("claude"),
      runtimeMode: "full-access",
      browserAccessEnabled: true,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    // Well past the liveness window in total, but each turn reports in before
    // it lapses — this is the long-session case that used to lose the toolkit.
    for (let turn = 0; turn < 10; turn += 1) {
      timestamp += 99;
      yield* registry.touch(threadId);
    }

    const resolved = yield* registry.resolve(token);
    expect(resolved?.threadId).toBe(threadId);
    expect(resolved?.maxRuntimeMode).toBe("full-access");
  }),
);

it.effect("does not keep credentials of other threads alive", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-4"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "auto",
      browserAccessEnabled: true,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    timestamp += 99;
    yield* registry.touch(ThreadId.make("thread-unrelated"));
    timestamp += 2;

    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("grants child control only to the issuing provider session", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const first = yield* registry.issue({
      threadId: ThreadId.make("thread-parent-1"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "auto",
      browserAccessEnabled: true,
    });
    const second = yield* registry.issue({
      threadId: ThreadId.make("thread-parent-2"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      runtimeMode: "auto",
      browserAccessEnabled: true,
    });
    const firstToken = first.config.authorizationHeader.replace(/^Bearer\s+/, "");
    const secondToken = second.config.authorizationHeader.replace(/^Bearer\s+/, "");
    const firstScope = yield* registry.resolve(firstToken);
    const childId = ThreadId.make("thread-child");

    expect(yield* registry.grantControlledThread(firstScope!.providerSessionId, childId)).toBe(
      true,
    );
    expect((yield* registry.resolve(firstToken))?.controlledThreadIds).toEqual(new Set([childId]));
    expect((yield* registry.resolve(secondToken))?.controlledThreadIds).toEqual(new Set());
    expect(yield* registry.grantControlledThread("missing-provider-session", childId)).toBe(false);

    yield* registry.revokeProviderSession(firstScope!.providerSessionId);
    expect(yield* registry.resolve(firstToken)).toBeUndefined();
    expect((yield* registry.resolve(secondToken))?.threadId).toBe(ThreadId.make("thread-parent-2"));
  }),
);
