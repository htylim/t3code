import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { hasQueuedTurnStart, projectThreadStatus } from "./status.ts";

const now = "2026-08-08T12:00:00.000Z";
const before = "2026-08-08T11:59:30.000Z";

function shell(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: ThreadId.make("thread-status"),
    projectId: ProjectId.make("project-status"),
    title: "Status thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    },
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: before,
    updatedAt: before,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    titleRegeneration: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    backgroundLiveness: null,
    ...overrides,
  };
}

const latestTurn = (
  state: NonNullable<OrchestrationThreadShell["latestTurn"]>["state"],
): NonNullable<OrchestrationThreadShell["latestTurn"]> => ({
  turnId: TurnId.make(`turn-${state}`),
  state,
  requestedAt: before,
  startedAt: before,
  completedAt: state === "running" ? null : before,
  assistantMessageId: null,
});

const session = (
  status: NonNullable<OrchestrationThreadShell["session"]>["status"],
): NonNullable<OrchestrationThreadShell["session"]> => ({
  threadId: ThreadId.make("thread-status"),
  status,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "auto",
  activeTurnId: status === "running" ? TurnId.make("turn-running") : null,
  lastError: status === "error" ? "failed" : null,
  updatedAt: before,
});

describe("projectThreadStatus", () => {
  it("covers every foreground execution status", () => {
    const cases = [
      [shell(), "idle"],
      [shell({ session: session("starting") }), "starting"],
      [shell({ session: session("running") }), "running"],
      [shell({ latestTurn: latestTurn("running") }), "running"],
      [shell({ latestTurn: latestTurn("completed") }), "completed"],
      [shell({ latestTurn: latestTurn("interrupted") }), "interrupted"],
      [shell({ latestTurn: latestTurn("error") }), "error"],
    ] as const;

    for (const [input, expected] of cases) {
      const status = projectThreadStatus(input, { cursor: 4, now });
      expect(status.status).toBe(expected);
      expect(status.foregroundStatus).toBe(expected);
    }
  });

  it("reports both blockers and gives approval primary precedence", () => {
    const status = projectThreadStatus(
      shell({
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        session: session("running"),
      }),
      { cursor: 5, now },
    );
    expect(status.status).toBe("waiting_for_approval");
    expect(status.foregroundStatus).toBe("running");
    expect(status.blockedOn).toEqual(["approval", "user_input"]);
  });

  it("reports user input when it is the only blocker", () => {
    expect(
      projectThreadStatus(shell({ hasPendingUserInput: true }), { cursor: 0, now }).status,
    ).toBe("waiting_for_user_input");
  });

  it("lets a failed session outrank a stale running turn", () => {
    const status = projectThreadStatus(
      shell({ session: session("error"), latestTurn: latestTurn("running") }),
      { cursor: 0, now },
    );
    expect(status.status).toBe("error");
    expect(status.foregroundStatus).toBe("error");
  });

  it("keeps completion foreground state while background work remains running", () => {
    const status = projectThreadStatus(
      shell({ latestTurn: latestTurn("completed"), backgroundLiveness: "monitoring" }),
      { cursor: 6, now },
    );
    expect(status.status).toBe("running");
    expect(status.foregroundStatus).toBe("completed");
    expect(status.backgroundLiveness).toBe("monitoring");
  });

  it("detects only recent unadopted messages as queued", () => {
    const queued = shell({ latestUserMessageAt: before });
    expect(hasQueuedTurnStart(queued, now)).toBe(true);
    expect(projectThreadStatus(queued, { cursor: 0, now }).status).toBe("queued");

    expect(hasQueuedTurnStart(queued, "2026-08-08T12:01:30.001Z")).toBe(false);
    expect(hasQueuedTurnStart(shell({ ...queued, session: session("error") }), now)).toBe(false);
    expect(
      hasQueuedTurnStart(
        shell({ latestUserMessageAt: before, latestTurn: latestTurn("completed") }),
        now,
      ),
    ).toBe(false);
  });

  it("keeps lifecycle metadata separate from execution status", () => {
    const status = projectThreadStatus(
      shell({
        archivedAt: before,
        settledOverride: "active",
        settledAt: before,
        snoozedAt: before,
        snoozedUntil: "2026-08-08T13:00:00.000Z",
        pinnedAt: before,
      }),
      { cursor: 7, now },
    );
    expect(status).toMatchObject({
      status: "idle",
      visibility: "archived",
      settledOverride: "unsettled",
      settledAt: before,
      snoozed: true,
      pinnedAt: before,
      cursor: 7,
    });
  });

  it("ends effective snooze on expiry or a raised hand", () => {
    const snoozed = {
      snoozedAt: before,
      snoozedUntil: "2026-08-08T13:00:00.000Z",
    } as const;
    expect(projectThreadStatus(shell(snoozed), { cursor: 0, now }).snoozed).toBe(true);
    expect(
      projectThreadStatus(shell({ ...snoozed, hasPendingApprovals: true }), { cursor: 0, now })
        .snoozed,
    ).toBe(false);
    expect(
      projectThreadStatus(shell(snoozed), {
        cursor: 0,
        now: "2026-08-08T13:00:00.000Z",
      }).snoozed,
    ).toBe(false);
  });
});
