import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { VcsCreateWorktreeResult, VcsListRefsResult } from "./git.ts";

export const FORK_WORKTREES_API_VERSION = 1;

export const ForkCapabilities = Schema.Struct({
  worktrees: Schema.optionalKey(Schema.Struct({ apiVersion: Schema.Int })),
});
export type ForkCapabilities = typeof ForkCapabilities.Type;

/** Missing or unknown API versions must not enable fork-only requests. */
export function supportsForkWorktrees(
  capabilities: { readonly fork?: ForkCapabilities | undefined } | null | undefined,
): boolean {
  return capabilities?.fork?.worktrees?.apiVersion === FORK_WORKTREES_API_VERSION;
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
    Schema.Struct({ worktreePath: Schema.String, latestActivityAt: NonNegativeInt }),
  ),
});
export type ForkWorktreeActivityResult = typeof ForkWorktreeActivityResult.Type;

/** A failed read must not make existing threads appear absent. */
export class ForkWorktreeActivityError extends Schema.TaggedError<ForkWorktreeActivityError>()(
  "ForkWorktreeActivityError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}
