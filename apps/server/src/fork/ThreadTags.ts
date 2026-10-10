import { SetThreadTagInput, ThreadTagError, ThreadTag } from "@t3tools/contracts";
import type { ThreadTags as ThreadTagsSnapshot } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

// Preserve future sidecar fields without adding them to today's wire contract.
const unknownFields = Schema.Record(Schema.String, Schema.Unknown);
const storedTag = Schema.StructWithRest(ThreadTag, [unknownFields]);
const ThreadTagsFile = Schema.StructWithRest(
  Schema.Struct({
    version: Schema.Literal(1),
    threads: Schema.Record(Schema.String, storedTag),
  }),
  [unknownFields],
);
const fileCodec = Schema.fromJsonString(ThreadTagsFile, { space: 2 });
const decodeFile = Schema.decodeUnknownEffect(fileCodec);
const encodeFile = Schema.encodeEffect(fileCodec);
const decodeInput = Schema.decodeUnknownEffect(SetThreadTagInput);

/** Fork metadata kept outside SQLite, owned by the thread's destination environment. */
export class ThreadTags extends Context.Service<
  ThreadTags,
  {
    /** Emit the current overrides first, followed by committed changes. */
    readonly changes: Stream.Stream<ThreadTagsSnapshot, ThreadTagError>;
    /** Set a label, or remove the override with null. Writes are atomic and serialized. */
    readonly set: (input: SetThreadTagInput) => Effect.Effect<void, ThreadTagError>;
  }
>()("t3/fork/ThreadTags") {}

/** Construct the store lazily so a damaged sidecar cannot prevent server startup. */
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const directory = path.join(serverConfig.stateDir, "fork");
  const filename = path.join(directory, "thread-tags.json");
  const changes = yield* SubscriptionRef.make<ThreadTagsSnapshot>({});
  const lock = yield* Semaphore.make(1);

  /** Missing files mean no overrides. Invalid files fail without being overwritten. */
  const readFile = Effect.gen(function* () {
    const contents = yield* fs.readFileString(filename).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );
    if (contents === null) return { version: 1 as const, threads: {} };
    return yield* decodeFile(contents);
  }).pipe(Effect.mapError((cause) => new ThreadTagError({ operation: "read", cause })));

  /** Read before subscribing while holding the write lock to avoid missing a concurrent update. */
  const initialize = lock.withPermits(1)(
    readFile.pipe(Effect.flatMap((document) => SubscriptionRef.set(changes, document.threads))),
  );

  /** Re-read under the lock so updates preserve other threads and unknown future fields. */
  const set = Effect.fn("ThreadTags.set")(function* (rawInput: SetThreadTagInput) {
    const input = yield* decodeInput(rawInput).pipe(
      Effect.mapError((cause) => new ThreadTagError({ operation: "write", cause })),
    );
    const thread = yield* projections
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError((cause) => new ThreadTagError({ operation: "read", cause })));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new ThreadTagError({ operation: "thread-not-found", cause: null });
    }
    yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const document = yield* readFile;
          const threads = { ...document.threads };
          if (input.tag === null) delete threads[input.threadId];
          else threads[input.threadId] = { ...threads[input.threadId], ...input.tag };
          // Rename within the same directory never exposes a half-written JSON document.
          yield* Effect.gen(function* () {
            yield* fs.makeDirectory(directory, { recursive: true });
            yield* Effect.acquireUseRelease(
              fs.makeTempDirectory({ directory, prefix: ".thread-tags-" }),
              (temporaryDirectory) =>
                Effect.gen(function* () {
                  const temporaryFile = path.join(temporaryDirectory, "tags.json");
                  const contents = yield* encodeFile({ ...document, threads });
                  yield* fs.writeFileString(temporaryFile, contents + "\n");
                  yield* fs.rename(temporaryFile, filename);
                }),
              (temporaryDirectory) =>
                fs.remove(temporaryDirectory, { recursive: true }).pipe(Effect.orDie),
            );
          }).pipe(Effect.mapError((cause) => new ThreadTagError({ operation: "write", cause })));
          yield* SubscriptionRef.set(changes, threads);
        }),
      )
      .pipe(Effect.uninterruptible);
  });

  return ThreadTags.of({
    changes: Stream.unwrap(initialize.pipe(Effect.as(SubscriptionRef.changes(changes)))),
    set,
  });
});

export const layer = Layer.effect(ThreadTags, make);
