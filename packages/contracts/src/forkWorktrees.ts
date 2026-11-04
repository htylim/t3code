import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { VcsCreateWorktreeResult, VcsListRefsResult } from "./git.ts";

export const FORK_WORKTREES_API_VERSION = 1;

export const ForkCapabilities = Schema.Struct({
  worktrees: Schema.optionalKey(
    Schema.Struct({ apiVersion: Schema.Int, sizeSubscription: Schema.optionalKey(Schema.Boolean) }),
  ),
});
export type ForkCapabilities = typeof ForkCapabilities.Type;

/** Missing or unknown API versions must not enable fork-only requests. */
export function supportsForkWorktrees(
  capabilities: { readonly fork?: ForkCapabilities | undefined } | null | undefined,
): boolean {
  return capabilities?.fork?.worktrees?.apiVersion === FORK_WORKTREES_API_VERSION;
}

/** Streaming measurements are additive to the original worktree API. */
export function supportsForkWorktreeMeasurements(
  capabilities: { readonly fork?: ForkCapabilities | undefined } | null | undefined,
): boolean {
  return (
    supportsForkWorktrees(capabilities) && capabilities?.fork?.worktrees?.sizeSubscription === true
  );
}

export const ForkWorktreeListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  refresh: Schema.optional(Schema.Boolean),
});
export type ForkWorktreeListInput = typeof ForkWorktreeListInput.Type;

export const ForkWorktreeListResult = Schema.Struct({
  ...VcsListRefsResult.fields,
  mainWorktreePath: Schema.optional(TrimmedNonEmptyString.pipe(Schema.NullOr)),
});
export type ForkWorktreeListResult = typeof ForkWorktreeListResult.Type;

export const ForkWorktreeRenameInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  newDirName: TrimmedNonEmptyString,
});
export type ForkWorktreeRenameInput = typeof ForkWorktreeRenameInput.Type;

export const ForkWorktreeRenameResult = Schema.Struct({
  worktree: VcsCreateWorktreeResult.fields.worktree,
});
export type ForkWorktreeRenameResult = typeof ForkWorktreeRenameResult.Type;

export const ForkWorktreeSizeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type ForkWorktreeSizeInput = typeof ForkWorktreeSizeInput.Type;

export const ForkWorktreeSizeResult = Schema.Struct({
  isLinkedWorktree: Schema.Boolean,
  /** Estimated allocated bytes freed by removal, excluding shared dependency files. */
  reclaimableBytes: Schema.NullOr(NonNegativeInt),
});
export type ForkWorktreeSizeResult = typeof ForkWorktreeSizeResult.Type;

export const ForkWorktreeActivityInput = Schema.Struct({
  worktreePaths: Schema.Array(TrimmedNonEmptyString),
});
export type ForkWorktreeActivityInput = typeof ForkWorktreeActivityInput.Type;

export const ForkWorktreeActivityResult = Schema.Struct({
  worktrees: Schema.Array(
    Schema.Struct({
      worktreePath: Schema.String,
      latestActivityAt: NonNegativeInt,
      threadsSettled: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
export type ForkWorktreeActivityResult = typeof ForkWorktreeActivityResult.Type;

/** A failed read must not make existing threads appear absent. */
export class ForkWorktreeActivityError extends Schema.TaggedError<ForkWorktreeActivityError>()(
  "ForkWorktreeActivityError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export const FORK_WORKTREE_MEASUREMENTS_BATCH_LIMIT = 256;

export const ForkWorktreeMeasurementsInput = Schema.Struct({
  worktrees: Schema.Array(ForkWorktreeSizeInput).check(
    Schema.isMaxLength(FORK_WORKTREE_MEASUREMENTS_BATCH_LIMIT),
  ),
});
export type ForkWorktreeMeasurementsInput = typeof ForkWorktreeMeasurementsInput.Type;

export const ForkWorktreeMeasurement = Schema.Struct({
  ...ForkWorktreeSizeInput.fields,
  state: Schema.Literals(["queued", "measuring", "ready", "unavailable"]),
  reclaimableBytes: Schema.NullOr(NonNegativeInt),
});
export type ForkWorktreeMeasurement = typeof ForkWorktreeMeasurement.Type;

export const ForkWorktreeMeasurementsSnapshot = Schema.Struct({
  worktrees: Schema.Array(ForkWorktreeMeasurement),
});
export type ForkWorktreeMeasurementsSnapshot = typeof ForkWorktreeMeasurementsSnapshot.Type;
