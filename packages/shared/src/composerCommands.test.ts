import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import {
  buildBuiltInComposerCommands,
  parseStandaloneComposerCommand,
  resolveThreadForkEligibility,
} from "./composerCommands.ts";

const SOURCE_ID = ThreadId.make("source");
const BOUND_PROVIDER = ProviderInstanceId.make("codex-work");

function thread(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: SOURCE_ID,
    projectId: ProjectId.make("project"),
    title: "Source",
    modelSelection: { instanceId: BOUND_PROVIDER, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/repo",
    latestTurn: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId: SOURCE_ID,
      status: "ready",
      providerName: "codex",
      providerInstanceId: BOUND_PROVIDER,
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-08-06T00:00:00.000Z",
    },
    latestUserMessageAt: "2026-08-05T23:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function eligibility(overrides: Record<string, unknown> = {}) {
  return resolveThreadForkEligibility({
    routeKind: "server",
    thread: thread(),
    environmentSupportsThreadFork: true,
    providerSupportsThreadFork: true,
    queuedTurnCount: 0,
    ...overrides,
  });
}

describe("composer commands", () => {
  it("does not intercept /fork with attachments or additional composer context", () => {
    expect(
      parseStandaloneComposerCommand({ text: "/fork", attachmentCount: 1, contextCount: 0 }),
    ).toBeNull();
    expect(
      parseStandaloneComposerCommand({ text: "/fork", attachmentCount: 0, contextCount: 1 }),
    ).toBeNull();
  });

  it("includes /fork for an eligible persisted thread on a supported environment and provider", () => {
    expect(eligibility()).toEqual({ eligible: true });
    expect(buildBuiltInComposerCommands({ forkEligibility: eligibility() })).toContainEqual(
      expect.objectContaining({ command: "fork", label: "/fork" }),
    );
  });

  it("includes /fork for a recent ready thread that is not classified as settled", () => {
    expect(eligibility({ thread: thread({ settledAt: null }) })).toEqual({ eligible: true });
  });

  it("ignores settle overrides inactivity and pull-request state when resolving fork eligibility", () => {
    expect(
      eligibility({
        thread: thread({
          settledOverride: "settled",
          settledAt: "2020-01-01T00:00:00.000Z",
          latestUserMessageAt: "2020-01-01T00:00:00.000Z",
        }),
      }),
    ).toEqual({ eligible: true });
  });

  it("omits /fork for a draft thread", () => {
    expect(eligibility({ routeKind: "draft" })).toMatchObject({ reason: "draft" });
  });

  it("omits /fork for a deleted or archived thread", () => {
    expect(eligibility({ deleted: true })).toMatchObject({ reason: "deleted" });
    expect(
      eligibility({ thread: thread({ archivedAt: "2026-08-06T00:00:00.000Z" }) }),
    ).toMatchObject({ reason: "archived" });
  });

  it("omits /fork while a turn or background agent is working", () => {
    expect(
      eligibility({ thread: thread({ session: { ...thread().session!, status: "starting" } }) }),
    ).toMatchObject({ reason: "work-in-flight" });
    expect(
      eligibility({
        thread: thread({
          latestTurn: {
            turnId: "turn" as never,
            state: "running",
            requestedAt: "2026-08-06T00:00:00.000Z",
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      }),
    ).toMatchObject({ reason: "work-in-flight" });
    expect(eligibility({ queuedTurnCount: 1 })).toMatchObject({ reason: "work-in-flight" });
    expect(eligibility({ thread: thread({ backgroundLiveness: "working" }) })).toMatchObject({
      reason: "work-in-flight",
    });
    expect(eligibility({ thread: thread({ backgroundLiveness: "monitoring" }) })).toMatchObject({
      reason: "work-in-flight",
    });
  });

  it("omits /fork while approval or user input is pending", () => {
    expect(eligibility({ thread: thread({ hasPendingApprovals: true }) })).toMatchObject({
      reason: "pending-request",
    });
    expect(eligibility({ thread: thread({ hasPendingUserInput: true }) })).toMatchObject({
      reason: "pending-request",
    });
  });

  it("omits /fork for an old server without threadFork capability", () => {
    expect(eligibility({ environmentSupportsThreadFork: false })).toMatchObject({
      reason: "unsupported-environment",
    });
  });

  it("omits /fork for a provider that does not support native fork", () => {
    expect(eligibility({ providerSupportsThreadFork: false })).toMatchObject({
      reason: "unsupported-provider",
    });
  });

  it("resolves fork support from the bound session provider instance", () => {
    expect(
      resolveThreadForkEligibility({
        routeKind: "server",
        thread: thread(),
        environmentSupportsThreadFork: true,
        providers: [{ instanceId: BOUND_PROVIDER, supportsThreadFork: true }],
        queuedTurnCount: 0,
      }),
    ).toEqual({ eligible: true });
  });

  it("does not use an unsaved composer provider selection to resolve fork support", () => {
    expect(
      resolveThreadForkEligibility({
        routeKind: "server",
        thread: thread({
          modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "cursor" },
        }),
        environmentSupportsThreadFork: true,
        providers: [{ instanceId: BOUND_PROVIDER, supportsThreadFork: true }],
        queuedTurnCount: 0,
      }),
    ).toEqual({ eligible: true });
  });
});
