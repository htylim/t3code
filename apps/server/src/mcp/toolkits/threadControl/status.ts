import type { OrchestrationThreadShell } from "@t3tools/contracts";

import type { ThreadControlStatus } from "./schemas.ts";

export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

type PublicStatus = typeof ThreadControlStatus.Type;
type ForegroundStatus = PublicStatus["foregroundStatus"];

export function hasQueuedTurnStart(
  shell: Pick<OrchestrationThreadShell, "latestUserMessageAt" | "latestTurn" | "session">,
  now: string,
): boolean {
  if (shell.latestUserMessageAt === null || shell.session?.status === "error") return false;
  const messageAt = Date.parse(shell.latestUserMessageAt);
  const nowAt = Date.parse(now);
  if (
    !Number.isFinite(messageAt) ||
    !Number.isFinite(nowAt) ||
    Math.abs(nowAt - messageAt) > QUEUED_TURN_START_GRACE_MS
  ) {
    return false;
  }
  if (shell.latestTurn === null) return true;
  return [
    shell.latestTurn.requestedAt,
    shell.latestTurn.startedAt,
    shell.latestTurn.completedAt,
  ].every((candidate) => candidate === null || Date.parse(candidate) < messageAt);
}

export function deriveForegroundStatus(
  shell: OrchestrationThreadShell,
  now: string,
): ForegroundStatus {
  if (shell.session?.status === "starting") return "starting";
  if (shell.session?.status === "running") return "running";
  if (hasQueuedTurnStart(shell, now)) return "queued";
  if (shell.session?.status === "error" || shell.latestTurn?.state === "error") return "error";
  if (shell.session?.status === "interrupted" || shell.latestTurn?.state === "interrupted") {
    return "interrupted";
  }
  if (shell.latestTurn?.state === "running") return "running";
  if (shell.latestTurn?.state === "completed") return "completed";
  return "idle";
}

function raisedHandWhileSnoozed(shell: OrchestrationThreadShell): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return true;
  if (
    shell.session?.status === "error" &&
    (shell.snoozedAt == null || Date.parse(shell.session.updatedAt) > Date.parse(shell.snoozedAt))
  ) {
    return true;
  }
  return (
    shell.snoozedAt != null &&
    shell.latestTurn?.state === "completed" &&
    shell.latestTurn.completedAt != null &&
    Date.parse(shell.latestTurn.completedAt) > Date.parse(shell.snoozedAt)
  );
}

export function isEffectivelySnoozed(shell: OrchestrationThreadShell, now: string): boolean {
  if (shell.snoozedUntil == null) return false;
  const wakeAt = Date.parse(shell.snoozedUntil);
  const nowAt = Date.parse(now);
  return (
    Number.isFinite(wakeAt) &&
    Number.isFinite(nowAt) &&
    wakeAt > nowAt &&
    !raisedHandWhileSnoozed(shell)
  );
}

export function projectThreadStatus(
  shell: OrchestrationThreadShell,
  input: { readonly cursor: number; readonly now: string },
): PublicStatus {
  const foregroundStatus = deriveForegroundStatus(shell, input.now);
  const blockedOn = [
    ...(shell.hasPendingApprovals ? (["approval"] as const) : []),
    ...(shell.hasPendingUserInput ? (["user_input"] as const) : []),
  ];
  const backgroundLiveness = shell.backgroundLiveness ?? null;
  const status = shell.hasPendingApprovals
    ? "waiting_for_approval"
    : shell.hasPendingUserInput
      ? "waiting_for_user_input"
      : foregroundStatus === "starting" || foregroundStatus === "running"
        ? foregroundStatus
        : foregroundStatus === "queued"
          ? "queued"
          : foregroundStatus === "error"
            ? "error"
            : foregroundStatus === "interrupted"
              ? "interrupted"
              : backgroundLiveness !== null
                ? "running"
                : foregroundStatus;

  return {
    threadId: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    visibility: shell.archivedAt === null ? "active" : "archived",
    status,
    foregroundStatus,
    blockedOn,
    hasPendingApproval: shell.hasPendingApprovals,
    hasPendingUserInput: shell.hasPendingUserInput,
    backgroundLiveness,
    latestTurnId: shell.latestTurn?.turnId ?? null,
    latestTurnRequestedAt: shell.latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: shell.latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: shell.latestTurn?.completedAt ?? null,
    sessionStatus: shell.session?.status ?? null,
    sessionLastError: shell.session?.lastError ?? null,
    modelSelection: shell.modelSelection,
    runtimeMode: shell.runtimeMode,
    interactionMode: shell.interactionMode,
    branch: shell.branch,
    worktreePath: shell.worktreePath,
    settledOverride: shell.settledOverride === "active" ? "unsettled" : shell.settledOverride,
    settledAt: shell.settledAt,
    snoozedAt: shell.snoozedAt ?? null,
    snoozedUntil: shell.snoozedUntil ?? null,
    snoozed: isEffectivelySnoozed(shell, input.now),
    pinnedAt: shell.pinnedAt ?? null,
    archivedAt: shell.archivedAt,
    createdAt: shell.createdAt,
    updatedAt: shell.updatedAt,
    cursor: input.cursor,
  };
}
