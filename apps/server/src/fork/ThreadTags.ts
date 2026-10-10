import { SetThreadTagInput, ThreadTagError, ThreadTag, ThreadId } from "@t3tools/contracts";
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
    inheritedFrom: Schema.optional(Schema.Record(Schema.String, ThreadId)),
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
    /** Copy a source tag once. Replayed creation effects preserve later edits and clears. */
    readonly inherit: (input: {
      readonly sourceThreadId: ThreadId;
      readonly threadId: ThreadId;
    }) => Effect.Effect<void, ThreadTagError>;
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

  /** Replace the whole sidecar atomically, then publish only committed tags. Requires the lock. */
  const writeFile = Effect.fn("ThreadTags.writeFile")(function* (
    document: typeof ThreadTagsFile.Type,
  ) {
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* Effect.acquireUseRelease(
        fs.makeTempDirectory({ directory, prefix: ".thread-tags-" }),
        (temporaryDirectory) =>
          Effect.gen(function* () {
            const temporaryFile = path.join(temporaryDirectory, "tags.json");
            const contents = yield* encodeFile(document);
            yield* fs.writeFileString(temporaryFile, contents + "\n");
            yield* fs.rename(temporaryFile, filename);
          }),
        (temporaryDirectory) =>
          fs.remove(temporaryDirectory, { recursive: true }).pipe(Effect.orDie),
      );
    }).pipe(Effect.mapError((cause) => new ThreadTagError({ operation: "write", cause })));
    yield* SubscriptionRef.set(changes, document.threads);
  });

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
          yield* writeFile({ ...document, threads });
        }),
      )
      .pipe(Effect.uninterruptible);
  });

  /** Serialize the copy with edits and persist completion even when the source has no tag. */
  const inherit = Effect.fn("ThreadTags.inherit")(function* (input: {
    readonly sourceThreadId: ThreadId;
    readonly threadId: ThreadId;
  }) {
    if (input.sourceThreadId === input.threadId) return;
    const thread = yield* projections
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError((cause) => new ThreadTagError({ operation: "read", cause })));
    // Deletion can win the race with the creation effect. It needs no tag or retry.
    if (thread === null || thread.deletedAt !== null) return;
    yield* lock
      .withPermits(1)(
        Effect.gen(function* () {
          const document = yield* readFile;
          if (document.inheritedFrom?.[input.threadId] !== undefined) return;
          const threads = { ...document.threads };
          const sourceTag = threads[input.sourceThreadId];
          if (threads[input.threadId] === undefined && sourceTag !== undefined) {
            threads[input.threadId] = { ...sourceTag };
          }
          yield* writeFile({
            ...document,
            threads,
            inheritedFrom: { ...document.inheritedFrom, [input.threadId]: input.sourceThreadId },
          });
        }),
      )
      .pipe(Effect.uninterruptible);
  });

  return ThreadTags.of({
    changes: Stream.unwrap(initialize.pipe(Effect.as(SubscriptionRef.changes(changes)))),
    set,
    inherit,
  });
});

export const layer = Layer.effect(ThreadTags, make);
