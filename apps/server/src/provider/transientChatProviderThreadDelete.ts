import type { ClaudeSettings, CodexSettings, OpenCodeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

import { expandHomePath } from "../pathExpansion.ts";
import { spawnAndCollect } from "./providerSnapshot.ts";
import { makeClaudeEnvironment } from "./Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { resolveCodexLaunchArgs } from "./Layers/codexLaunchArgs.ts";
import { withCodexAppServerClient } from "./Layers/CodexProvider.ts";
import { OpenCodeRuntime } from "./opencodeRuntime.ts";
import { deleteCodexTransientThread } from "./transientChatDeletion/codex.ts";
import { deleteOpenCodeTransientThread } from "./transientChatDeletion/opencode.ts";
import {
  deletionError,
  TransientChatProviderThreadDeleteError,
} from "./transientChatDeletion/errors.ts";

type Target = {
  /** Native provider ID, not the T3 thread ID. */
  readonly providerSessionId: string;
  readonly cwd: string;
  /** The merged environment belonging to the provider instance that created the session. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Cleanup retries may accept a confirmed absent target. Unsafe/unreadable targets still fail. */
  readonly allowMissing?: boolean;
};

export type TransientChatProviderThreadDeleteInput = Target &
  (
    | { readonly provider: "codex"; readonly config: CodexSettings }
    | { readonly provider: "claudeAgent"; readonly config: ClaudeSettings }
    | { readonly provider: "opencode"; readonly config: OpenCodeSettings }
  );

const WorkerResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    outcome: Schema.Literals(["deleted", "already-absent"]),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: TransientChatProviderThreadDeleteError.fields.reason,
    message: Schema.String,
  }),
]);
const decodeWorkerResult = Schema.decodeEffect(Schema.fromJsonString(WorkerResult));
const isUuid = Schema.is(Schema.String.check(Schema.isUUID()));
const isOpenCodeId = Schema.is(Schema.String.check(Schema.isPattern(/^ses_[a-zA-Z0-9]+$/)));

/**
 * Deletes one native session for a transient side chat, without touching T3 state.
 * The caller must own the transient registration, stop its runtime, and prevent
 * resume/fork while this runs. Pass the original provider configuration and native
 * ID before removing T3's binding. Missing targets fail unless allowMissing is set.
 * Unsafe targets always fail; deletion never falls
 * back to archiving, cascading deletion, or deleting files by a guessed path.
 */
export const deleteTransientChatProviderThread = Effect.fn("deleteTransientChatProviderThread")(
  function* (input: TransientChatProviderThreadDeleteInput) {
    const path = yield* Path.Path;
    const isProviderSessionId = input.provider === "opencode" ? isOpenCodeId : isUuid;
    if (!isProviderSessionId(input.providerSessionId) || !path.isAbsolute(input.cwd)) {
      return yield* new TransientChatProviderThreadDeleteError({
        provider: input.provider,
        providerSessionId: input.providerSessionId,
        reason: "invalid-target",
        message: "A native session ID and an absolute project directory are required.",
      });
    }
    switch (input.provider) {
      case "codex": {
        const home = yield* resolveCodexHomeLayout(input.config);
        const { client } = yield* withCodexAppServerClient({
          binaryPath: expandHomePath(input.config.binaryPath),
          homePath: home.effectiveHomePath,
          launchArgs: resolveCodexLaunchArgs(input.config.launchArgs, input.environment),
          cwd: input.cwd,
          environment: input.environment,
        });
        return yield* deleteCodexTransientThread(
          client.raw,
          input.providerSessionId,
          input.allowMissing,
        );
      }
      case "claudeAgent": {
        const environment = yield* makeClaudeEnvironment(input.config, input.environment);
        const workerPath = yield* path.fromFileUrl(
          new URL(
            import.meta.url.endsWith(".ts")
              ? "../transientChatProviderThreadDeleteWorker.ts"
              : "./transientChatProviderThreadDeleteWorker.mjs",
            import.meta.url,
          ),
        );
        const result = yield* spawnAndCollect(
          process.execPath,
          ChildProcess.make(
            process.execPath,
            [workerPath, input.providerSessionId, input.cwd, String(input.allowMissing === true)],
            {
              env: { ...environment, ELECTRON_RUN_AS_NODE: "1" },
            },
          ),
        );
        if (result.code !== 0) {
          return yield* new TransientChatProviderThreadDeleteError({
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            reason: "provider-error",
            message: result.stderr || "Claude deletion worker failed.",
          });
        }
        const outcome = yield* decodeWorkerResult(result.stdout);
        if (!outcome.ok) {
          return yield* new TransientChatProviderThreadDeleteError({
            provider: input.provider,
            providerSessionId: input.providerSessionId,
            reason: outcome.reason,
            message: outcome.message,
          });
        }
        return outcome.outcome;
      }
      case "opencode": {
        const runtime = yield* OpenCodeRuntime;
        const server = yield* runtime.connectToOpenCodeServer({
          binaryPath: expandHomePath(input.config.binaryPath),
          directory: input.cwd,
          serverUrl: input.config.serverUrl,
          ...(input.config.serverPassword ? { serverPassword: input.config.serverPassword } : {}),
          ...(input.environment ? { environment: input.environment } : {}),
        });
        const client = runtime.createOpenCodeSdkClient({
          baseUrl: server.url,
          directory: input.cwd,
          ...(server.serverPassword !== undefined ? { serverPassword: server.serverPassword } : {}),
        });
        return yield* deleteOpenCodeTransientThread(
          client,
          input.providerSessionId,
          input.cwd,
          input.allowMissing,
        );
      }
    }
  },
  Effect.scoped,
  Effect.timeout("30 seconds"),
  (effect, input) =>
    effect.pipe(
      Effect.mapError((cause) => deletionError(input.provider, input.providerSessionId, cause)),
    ),
);
