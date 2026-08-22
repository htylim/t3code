import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PreviewTabId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import { makeProviderRegistryMock } from "../provider/testUtils/providerRegistryMock.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as ThreadControlRegistration from "./toolkits/threadControl/registration.ts";
import { ThreadControlPartialFailure } from "./toolkits/threadControl/schemas.ts";

const environmentId = EnvironmentId.make("environment-mcp-test");
const threadId = ThreadId.make("thread-mcp-test");
const tabId = PreviewTabId.make("tab-mcp-test");
const alternateTabId = PreviewTabId.make("tab-mcp-alternate");
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});
const invocation = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-mcp-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview", "thread-control"] as const),
  maxRuntimeMode: "auto" as const,
  controlledThreadIds: new Set<ThreadId>(),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const ThreadControlReadDependencies = Layer.mergeAll(
  Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
    getThreadShellById: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        projects: [],
        threads: [],
        updatedAt: "1970-01-01T00:00:00.000Z",
      }),
    getArchivedShellSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        projects: [],
        threads: [],
        updatedAt: "1970-01-01T00:00:00.000Z",
      }),
    getThreadDetailById: () => Effect.die("thread-control read tools must not load detail"),
    getThreadDetailSnapshot: () => Effect.die("thread-control read tools must not load detail"),
  }),
  Layer.succeed(ProviderRegistry.ProviderRegistry, makeProviderRegistryMock()),
  Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
    dispatch: () => Effect.die("thread-control mutations are unused"),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  }),
  Layer.mock(GitVcsDriver.GitVcsDriver)({
    execute: () => Effect.die("workspace validation is unused"),
  }),
  Layer.succeed(
    McpSessionRegistry.McpSessionRegistry,
    McpSessionRegistry.McpSessionRegistry.of({
      issue: () => Effect.die("credential issuance is unused"),
      resolve: () => Effect.die("credential resolution is unused"),
      touch: () => Effect.void,
      grantControlledThread: () => Effect.die("thread-control mutations are unused"),
      revokeProviderSession: () => Effect.void,
      revokeThread: () => Effect.void,
      revokeAll: Effect.void,
    }),
  ),
);
const TestLayer = McpHttpServer.McpToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
  Layer.provide(ThreadControlReadDependencies),
  Layer.provide(NodeServices.layer),
);

it("normalizes empty successful notification responses to accepted", () => {
  const notificationResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.text("", { status: 200, contentType: "application/json" }),
  );
  expect(notificationResponse.status).toBe(202);

  const resultResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: 1, result: {} }),
  );
  expect(resultResponse.status).toBe(200);
});

it.effect("returns bounded structural preview snapshot failures", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const events = yield* broker.connect({
        clientId: "mcp-failure-client",
        environmentId,
      });
      yield* Stream.runForEach(events, (event) =>
        event.type === "connected"
          ? Effect.void
          : broker.respond({
              clientId: "mcp-failure-client",
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: false,
              error: {
                _tag: "PreviewAutomationExecutionError",
                message: "sensitive renderer failure",
                detail: { consoleOutput: "sensitive browser output" },
              },
            }),
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const snapshot = yield* server
        .callTool({ name: "preview_snapshot", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );

      expect(snapshot.isError).toBe(true);
      expect(snapshot.content).toEqual([{ type: "text", text: "Preview snapshot failed." }]);
      expect(snapshot.structuredContent).toEqual({
        error: {
          _tag: "PreviewAutomationExecutionError",
          operation: "snapshot",
          failureCount: 1,
        },
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("preserves structured thread-control diagnostics", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const result = yield* server.callTool({ name: "thread_context", arguments: {} }).pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...invocation,
          capabilities: new Set(["preview"] as const),
        }),
        Effect.provideService(McpSchema.McpServerClient, client),
      );

      expect(result).toMatchObject({
        isError: true,
        structuredContent: {
          code: "capability_denied",
          operation: "thread_context",
          retryable: false,
          environmentId,
          callingThreadId: threadId,
          providerSessionId: invocation.providerSessionId,
          providerInstanceId: invocation.providerInstanceId,
        },
      });
      const textContent = result.content[0];
      expect(textContent?.type).toBe("text");
      if (textContent?.type === "text") {
        const decodedText = yield* decodeUnknownJson(textContent.text);
        expect(decodedText).toEqual(result.structuredContent);
      }
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("bounds an item-free thread_read result with oversized status metadata", () => {
  const readProjectId = ProjectId.make("project-read-protocol");
  const readTurnId = TurnId.make("turn-read-protocol");
  const oversized = "oversized-status-metadata".repeat(5_000);
  let detailReads = 0;
  const readShell = {
    id: threadId,
    projectId: readProjectId,
    title: oversized,
    modelSelection: {
      instanceId: invocation.providerInstanceId,
      model: oversized,
      options: [{ id: oversized, value: oversized }],
    },
    runtimeMode: "auto" as const,
    interactionMode: "default" as const,
    branch: oversized,
    worktreePath: oversized,
    latestTurn: {
      turnId: readTurnId,
      state: "running" as const,
      requestedAt: "2026-08-09T00:00:00.000Z",
      startedAt: "2026-08-09T00:00:00.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:01.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    titleRegeneration: null,
    session: {
      threadId,
      status: "error" as const,
      providerName: "codex",
      providerInstanceId: invocation.providerInstanceId,
      runtimeMode: "auto" as const,
      activeTurnId: null,
      lastError: oversized,
      updatedAt: "2026-08-09T00:00:01.000Z",
    },
    latestUserMessageAt: null,
    hasPendingApprovals: true,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    backgroundLiveness: "working" as const,
  };
  const readDependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
      getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 91 }),
      getThreadShellById: () => Effect.succeed(Option.some(readShell)),
      getArchivedShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 91,
          projects: [],
          threads: [],
          updatedAt: "2026-08-09T00:00:01.000Z",
        }),
      getThreadDetailById: () => Effect.die("thread_read must use the consistent detail snapshot"),
      getThreadDetailSnapshot: () => {
        detailReads += 1;
        return Effect.succeed(
          Option.some({
            snapshotSequence: 91,
            thread: {
              id: threadId,
              projectId: readProjectId,
              title: "Protocol read",
              modelSelection: {
                instanceId: invocation.providerInstanceId,
                model: "gpt-5.6-sol",
              },
              runtimeMode: "auto",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              latestTurn: {
                turnId: readTurnId,
                state: "running",
                requestedAt: "2026-08-09T00:00:00.000Z",
                startedAt: "2026-08-09T00:00:00.000Z",
                completedAt: null,
                assistantMessageId: null,
              },
              createdAt: "2026-08-09T00:00:00.000Z",
              updatedAt: "2026-08-09T00:00:01.000Z",
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              snoozedUntil: null,
              snoozedAt: null,
              pinnedAt: null,
              titleRegeneration: null,
              deletedAt: null,
              messages: [],
              proposedPlans: [],
              activities: [],
              checkpoints: [],
              session: readShell.session,
            },
          }),
        );
      },
    }),
    Layer.succeed(ProviderRegistry.ProviderRegistry, makeProviderRegistryMock()),
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: () => Effect.die("unused"),
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(91),
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: () => Effect.die("unused"),
    }),
    Layer.succeed(
      McpSessionRegistry.McpSessionRegistry,
      McpSessionRegistry.McpSessionRegistry.of({
        issue: () => Effect.die("unused"),
        resolve: () => Effect.die("unused"),
        touch: () => Effect.void,
        grantControlledThread: () => Effect.die("unused"),
        revokeProviderSession: () => Effect.void,
        revokeThread: () => Effect.void,
        revokeAll: Effect.void,
      }),
    ),
  );
  const readLayer = ThreadControlRegistration.layer.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(readDependencies),
    Layer.provide(NodeServices.layer),
  );

  return Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const result = yield* server
        .callTool({
          name: "thread_read",
          arguments: { threadId, view: "final", maxBytes: 4_096 },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      const actualBytes = Buffer.byteLength(encodeUnknownJson(result), "utf8");
      expect(actualBytes).toBeLessThanOrEqual(4_096);
      expect(result.structuredContent).toMatchObject({
        view: "final",
        message: null,
        status: {
          status: "waiting_for_approval",
          foregroundStatus: "error",
          blockedOn: ["approval"],
          backgroundLiveness: "working",
          cursor: 91,
        },
        truncated: false,
        truncatedFieldCount: 0,
        returnedBytes: actualBytes,
        maxBytes: 4_096,
      });
      expect(result.structuredContent).not.toHaveProperty("threadId");
      expect(result.structuredContent?.status).not.toHaveProperty("title");
      const text = result.content[0];
      expect(text?.type).toBe("text");
      if (text?.type === "text") {
        expect(yield* decodeUnknownJson(text.text)).toEqual(result.structuredContent);
      }
      expect(detailReads).toBe(1);
    }),
  ).pipe(Effect.provide(readLayer));
});

it.effect("preserves partial thread-control recovery data", () =>
  Effect.gen(function* () {
    const result = yield* ThreadControlRegistration.__testing.threadControlFailure(
      "thread_send",
      Cause.fail(
        new ThreadControlPartialFailure({
          code: "partial_failure",
          operation: "thread_send",
          message: "The model changed, but the message was rejected.",
          retryable: true,
          targetThreadId: ThreadId.make("thread-partial-failure"),
          acceptedSteps: { modelUpdate: true, message: false },
          lastCursor: 10,
        }),
      ),
    );

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        code: "partial_failure",
        operation: "thread_send",
        retryable: true,
        targetThreadId: "thread-partial-failure",
        acceptedSteps: { modelUpdate: true, message: false },
        lastCursor: 10,
      },
    });
  }),
);

it.effect("sanitizes unexpected thread-control failures", () =>
  Effect.gen(function* () {
    const result = yield* ThreadControlRegistration.__testing.threadControlFailure(
      "thread_status",
      Cause.fail(new Error("sensitive database failure")),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Thread-control tool execution failed due to an internal server error.",
      },
    ]);
  }),
);

it.effect("terminates HTTP MCP sessions with DELETE", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const serverLayer = McpServer.layerHttp({
        name: "MCP termination test",
        version: "1.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18],
      });
      yield* HttpRouter.serve(serverLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;

      const initializeResponse = yield* httpClient.post("/mcp", {
        headers: { accept: "application/json, text/event-stream" },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(initializeResponse.status).toBe(200);
      expect(sessionId).not.toBeNull();

      const missingSessionResponse = yield* httpClient.del("/mcp");
      expect(missingSessionResponse.status).toBe(400);

      const unknownSessionResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": "unknown-session" },
      });
      expect(unknownSessionResponse.status).toBe(404);

      const terminateResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": sessionId! },
      });
      expect(terminateResponse.status).toBe(204);

      const reusedSessionResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}`,
          "application/json",
        ),
      });
      expect(reusedSessionResponse.status).toBe(404);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("registers annotated tools and preserves authenticated request context", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const routedRequests: Array<{
        readonly operation: string;
        readonly tabId?: string | undefined;
      }> = [];
      const events = yield* broker.connect({
        clientId: "mcp-test-client",
        environmentId,
      });
      yield* Stream.runForEach(events, (event) => {
        if (event.type === "connected") return Effect.void;
        routedRequests.push(event.request);
        return broker.respond({
          clientId: "mcp-test-client",
          connectionId: event.connectionId,
          requestId: event.request.requestId,
          ok: true,
          result:
            event.request.operation === "snapshot"
              ? {
                  url: "http://example.test/",
                  title: "Example",
                  loading: false,
                  visibleText: "Example",
                  interactiveElements: [],
                  accessibilityTree: {},
                  consoleEntries: [],
                  networkEntries: [],
                  actionTimeline: [],
                  screenshot: {
                    mimeType: "image/png",
                    data: Buffer.from("png").toString("base64"),
                    width: 10,
                    height: 5,
                  },
                }
              : event.request.operation === "press"
                ? undefined
                : {
                    available: true,
                    visible: true,
                    tabId,
                    url: "http://example.test/",
                    title: "Example",
                    loading: false,
                  },
        });
      }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      const registeredNames = server.tools.map(({ tool }) => tool.name);
      expect(registeredNames).toContain("preview_status");
      expect(registeredNames).toContain("preview_snapshot");
      expect(registeredNames).toContain("thread_context");
      expect(registeredNames).not.toContain("thread_respond");
      expect(new Set(registeredNames).size).toBe(registeredNames.length);

      const statusTool = server.tools.find(({ tool }) => tool.name === "preview_status");
      expect(statusTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(statusTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(statusTool?.tool.annotations?.destructiveHint).toBe(false);

      const snapshotTool = server.tools.find(({ tool }) => tool.name === "preview_snapshot");
      expect(snapshotTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.openWorldHint).toBe(true);

      const clickTool = server.tools.find(({ tool }) => tool.name === "preview_click");
      expect(clickTool?.tool.annotations?.readOnlyHint).toBe(false);
      expect(clickTool?.tool.annotations?.destructiveHint).toBe(true);
      expect(clickTool?.tool.annotations?.openWorldHint).toBe(true);
      expect(clickTool?.tool.outputSchema).toEqual({
        type: "object",
        additionalProperties: false,
        description: "The preview action completed successfully.",
      });

      const navigateTool = server.tools.find(({ tool }) => tool.name === "preview_navigate");
      expect(navigateTool?.tool.annotations?.destructiveHint).toBe(false);
      expect(navigateTool?.tool.annotations?.openWorldHint).toBe(true);

      const status = yield* server
        .callTool({ name: "preview_status", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(status.isError).toBe(false);
      expect(status.structuredContent).toMatchObject({
        available: true,
        tabId,
      });

      const malformed = yield* server
        .callTool({ name: "preview_click", arguments: { selector: "" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.flip,
        );
      expect(malformed._tag).toBe("InvalidParams");

      const snapshot = yield* server
        .callTool({ name: "preview_snapshot", arguments: { tabId: alternateTabId } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(snapshot.isError).toBe(false);
      expect(snapshot.content.some((content) => content.type === "image")).toBe(true);
      expect(snapshot.structuredContent).toMatchObject({
        screenshot: { mimeType: "image/png", width: 10, height: 5 },
      });
      expect(routedRequests.find(({ operation }) => operation === "snapshot")?.tabId).toBe(
        alternateTabId,
      );

      const actionRequests = [
        { name: "preview_click", arguments: { x: 10, y: 10 } },
        { name: "preview_type", arguments: { text: "Hello" } },
        { name: "preview_press", arguments: { key: "Enter" } },
        { name: "preview_scroll", arguments: { deltaY: 100 } },
        { name: "preview_wait_for", arguments: { text: "Example" } },
      ];
      for (const request of actionRequests) {
        const result = yield* server
          .callTool(request)
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({});
        expect(result.content).toEqual([{ type: "text", text: "{}" }]);
      }
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("lists both toolkits for a valid provider credential and rejects an invalid one", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* McpSessionRegistry.__testing
        .make({ now: () => 1 })
        .pipe(
          Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
          Effect.provide(NodeServices.layer),
        );
      const issued = yield* registry.issue({
        threadId,
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "auto",
        browserAccessEnabled: true,
      });
      const routes = McpHttpServer.layer.pipe(
        Layer.provide(Layer.succeed(McpSessionRegistry.McpSessionRegistry, registry)),
        Layer.provide(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
        Layer.provide(ThreadControlReadDependencies),
        Layer.provide(NodeServices.layer),
      );
      yield* HttpRouter.serve(routes, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;
      const initializeBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`;
      const invalidResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer invalid-provider-credential",
        },
        body: HttpBody.text(initializeBody, "application/json"),
      });
      expect(invalidResponse.status).toBe(401);

      const initializeResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: issued.config.authorizationHeader,
        },
        body: HttpBody.text(initializeBody, "application/json"),
      });
      expect(initializeResponse.status).toBe(200);
      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();

      const initializedResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: issued.config.authorizationHeader,
          "mcp-session-id": sessionId!,
          "mcp-protocol-version": "2025-06-18",
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
          "application/json",
        ),
      });
      expect(initializedResponse.status).toBe(202);

      const listResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: issued.config.authorizationHeader,
          "mcp-session-id": sessionId!,
          "mcp-protocol-version": "2025-06-18",
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
          "application/json",
        ),
      });
      expect(listResponse.status).toBe(200);
      const listBody = (yield* listResponse.json) as {
        readonly result: { readonly tools: ReadonlyArray<{ readonly name: string }> };
      };
      const toolNames = listBody.result.tools.map(({ name }) => name);
      expect(toolNames).toContain("preview_status");
      expect(toolNames).toContain("preview_snapshot");
      expect(toolNames).toContain("thread_context");
      expect(toolNames).not.toContain("thread_respond");

      const callResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: issued.config.authorizationHeader,
          "mcp-session-id": sessionId!,
          "mcp-protocol-version": "2025-06-18",
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"thread_context","arguments":{}}}`,
          "application/json",
        ),
      });
      expect(callResponse.status).toBe(200);
      const callBody = (yield* callResponse.json) as {
        readonly result: {
          readonly isError: boolean;
          readonly structuredContent: {
            readonly code: string;
            readonly operation: string;
            readonly retryable: boolean;
          };
        };
      };
      expect(callBody.result).toMatchObject({
        isError: true,
        structuredContent: {
          code: "internal_error",
          operation: "thread_context",
          retryable: false,
        },
      });

      const malformedCallResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          authorization: issued.config.authorizationHeader,
          "mcp-session-id": sessionId!,
          "mcp-protocol-version": "2025-06-18",
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"thread_status","arguments":{}}}`,
          "application/json",
        ),
      });
      expect(malformedCallResponse.status).toBe(200);
      const malformedCallBody = (yield* malformedCallResponse.json) as {
        readonly result: {
          readonly isError: boolean;
          readonly structuredContent: {
            readonly code: string;
            readonly operation: string;
            readonly retryable: boolean;
          };
        };
      };
      expect(malformedCallBody.result).toMatchObject({
        isError: true,
        structuredContent: {
          code: "invalid_request",
          operation: "thread_status",
          retryable: true,
        },
      });
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);
