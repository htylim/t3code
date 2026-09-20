import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { deleteClaudeTransientThread } from "./provider/transientChatDeletion/claude.ts";
import { deletionError } from "./provider/transientChatDeletion/errors.ts";

/** Deletes one validated Claude session in this isolated worker process. */
export async function runTransientChatDeletionWorker(args: readonly string[]): Promise<void> {
  const [providerSessionId, directory, allowMissing] = Schema.decodeUnknownSync(
    Schema.Tuple([
      Schema.String.check(Schema.isUUID()),
      Schema.String.check(Schema.isNonEmpty()),
      Schema.Literals(["true", "false"]),
    ]),
  )(args);
  const result = await Effect.runPromise(
    deleteClaudeTransientThread(providerSessionId, directory, allowMissing === "true").pipe(
      Effect.provide(NodeServices.layer),
      Effect.mapError((cause) => deletionError("claudeAgent", providerSessionId, cause)),
      Effect.match({
        onSuccess: (outcome) => ({ ok: true as const, outcome }),
        onFailure: (error) => ({
          ok: false as const,
          reason: error.reason,
          message: error.message,
        }),
      }),
    ),
  );
  process.stdout.write(JSON.stringify(result));
}
