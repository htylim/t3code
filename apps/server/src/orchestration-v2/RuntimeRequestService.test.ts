import { assert, it, vi } from "@effect/vitest";
import {
  NodeId,
  EnvironmentId,
  ProviderSessionId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as RuntimeRequestService from "./RuntimeRequestService.ts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";

it.effect(
  "delivers readable HTML quotes in question answers without changing saved answers",
  () => {
    const threadId = ThreadId.make("answer-thread");
    const providerSessionId = ProviderSessionId.make("answer-session");
    const requestId = RuntimeRequestId.make("answer-request");
    const quote = serializeAssistantCitation({
      version: 2,
      source: {
        kind: "html-attachment",
        environmentId: EnvironmentId.make("source-environment"),
        threadId,
        itemId: "html-row",
        attachmentId: "html-page",
        title: "Chart choices",
      },
      text: "Use a native table.",
      comment: "Explain this choice.",
      start: 0,
      end: 19,
      prefix: "",
      suffix: "",
    });
    const answers = Object.freeze({
      question: quote,
      options: ["Keep this option", quote],
      structured: { selected: true },
    });
    const respondToRuntimeRequest = vi.fn(
      (_input: ProviderAdapter.ProviderAdapterV2RuntimeRequestResponseInput) => Effect.void,
    );
    const layerTest = RuntimeRequestService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRuntimeRequest: () =>
              Effect.succeed({
                status: "resolved",
                responseCapability: { type: "live", providerSessionId },
              } as never),
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            get: () => Effect.succeed(Option.some({ respondToRuntimeRequest } as never)),
          }),
        ),
      ),
    );
    return Effect.gen(function* () {
      yield* (yield* RuntimeRequestService.RuntimeRequestServiceV2).respond({
        threadId,
        providerSessionId,
        requestId,
        answers,
      });
      const delivered = respondToRuntimeRequest.mock.calls[0]?.[0].answers;
      assert.include(String(delivered?.question), '"text": "Use a native table."');
      assert.include(String(delivered?.question), '"kind": "html-attachment"');
      assert.notInclude(String(delivered?.question), "t3-citation://");
      assert.equal((delivered?.options as string[])[0], "Keep this option");
      assert.include((delivered?.options as string[])[1]!, '"comment": "Explain this choice."');
      assert.deepEqual(delivered?.structured, { selected: true });
      assert.equal(answers.question, quote);
      assert.deepEqual(answers.options, ["Keep this option", quote]);
    }).pipe(Effect.provide(layerTest));
  },
);

it.effect.each(["expired", "resolved"] as const)(
  "responds only to resolved requests and preserves feedback (%s)",
  (status) => {
    const threadId = ThreadId.make("thread-runtime-request-expired");
    const providerSessionId = ProviderSessionId.make("provider-session-runtime-request-expired");
    const requestId = RuntimeRequestId.make("request-expired");
    const respondToRuntimeRequest = vi.fn(
      (_input: ProviderAdapter.ProviderAdapterV2RuntimeRequestResponseInput) => Effect.void,
    );
    const getSession = vi.fn(() =>
      Effect.succeed(
        Option.some({
          respondToRuntimeRequest,
        } as never),
      ),
    );
    const projection = {
      runtimeRequests: [
        {
          id: requestId,
          nodeId: NodeId.make("node-runtime-request-expired"),
          providerTurnId: null,
          nativeRequestRef: null,
          kind: "command",
          status,
          responseCapability: {
            type: "live",
            providerSessionId,
          },
          createdAt: DateTime.makeUnsafe("2026-07-29T00:00:00.000Z"),
          resolvedAt: DateTime.makeUnsafe("2026-07-29T00:00:01.000Z"),
        },
      ],
    } as unknown as OrchestrationV2ThreadProjection;
    const layerTest = RuntimeRequestService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRuntimeRequest: (_threadId, requestId) =>
              Effect.succeed(
                projection.runtimeRequests.find((request) => request.id === requestId),
              ),
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            get: getSession,
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const service = yield* RuntimeRequestService.RuntimeRequestServiceV2;
      const response = service.respond({
        threadId,
        providerSessionId,
        requestId,
        decision: "decline",
        feedback: "Use an explicit path.",
      });
      if (status === "resolved") {
        yield* response;
        assert.deepEqual(respondToRuntimeRequest.mock.calls, [
          [
            {
              requestId,
              decision: "decline",
              feedback: "Use an explicit path.",
            },
          ],
        ]);
        return;
      }
      const error = yield* response.pipe(Effect.flip);

      assert.equal(error.reason, "request-not-ready");
      assert.equal(
        error.message,
        `Runtime request ${requestId} on thread ${threadId} is not ready for response execution.`,
      );
      assert.isUndefined(error.cause);
      assert.equal(getSession.mock.calls.length, 0);
      assert.equal(respondToRuntimeRequest.mock.calls.length, 0);
    }).pipe(Effect.provide(layerTest));
  },
);
