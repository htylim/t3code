import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadTags from "./ThreadTags.ts";

const firstThreadId = ThreadId.make("first");
const secondThreadId = ThreadId.make("second");
const missingThreadId = ThreadId.make("missing");
const deletedThreadId = ThreadId.make("deleted");
const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
  getThreadShell: (threadId) =>
    Effect.succeed(
      threadId === missingThreadId
        ? null
        : ({
            id: threadId,
            deletedAt: threadId === deletedThreadId ? "2026-10-10T00:00:00Z" : null,
          } as OrchestrationV2ThreadShell),
    ),
});

/** Build a store with isolated paths and the projection stub. */
function createStoreLayer(baseDir: string) {
  return ThreadTags.layer.pipe(
    Layer.provide(projections),
    Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
  );
}

/** Give every test an isolated sidecar directory and a new service on each provide. */
const withStore = Effect.fnUntraced(function* <A, E, R>(
  use: (
    storeLayer: ReturnType<typeof createStoreLayer>,
    filename: string,
  ) => Effect.Effect<A, E, R>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-thread-tags-" });
  const storeLayer = createStoreLayer(baseDir);
  return yield* use(storeLayer, path.join(baseDir, "userdata", "fork", "thread-tags.json"));
});

/** Read the initial stream snapshot without leaving a subscriber running. */
const snapshot = Effect.gen(function* () {
  const store = yield* ThreadTags.ThreadTags;
  return yield* Stream.runHead(store.changes);
});

it.layer(NodeServices.layer)("fork thread tags", (it) => {
  it.effect(
    "inherits the label and color once, preserving later edits and clears after restart",
    () =>
      withStore((storeLayer) =>
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const store = yield* ThreadTags.ThreadTags;
            yield* store.set({
              threadId: firstThreadId,
              tag: { label: "parent", color: "#8b5cf6" },
            });
            yield* store.inherit({ sourceThreadId: firstThreadId, threadId: secondThreadId });
            assert.deepEqual(Option.getOrThrow(yield* snapshot)[secondThreadId], {
              label: "parent",
              color: "#8b5cf6",
            });
            yield* store.set({
              threadId: firstThreadId,
              tag: { label: "changed", color: "#ef4444" },
            });
            assert.deepEqual(Option.getOrThrow(yield* snapshot)[secondThreadId], {
              label: "parent",
              color: "#8b5cf6",
            });
            yield* store.set({ threadId: secondThreadId, tag: { label: "child", color: null } });
            yield* store.inherit({ sourceThreadId: firstThreadId, threadId: secondThreadId });
            assert.deepEqual(Option.getOrThrow(yield* snapshot)[secondThreadId], {
              label: "child",
              color: null,
            });
            yield* store.set({ threadId: secondThreadId, tag: null });
          }).pipe(Effect.provide(storeLayer));
          yield* Effect.gen(function* () {
            const store = yield* ThreadTags.ThreadTags;
            yield* store.inherit({ sourceThreadId: firstThreadId, threadId: secondThreadId });
            assert.isUndefined(Option.getOrThrow(yield* snapshot)[secondThreadId]);
          }).pipe(Effect.provide(storeLayer));
        }).pipe(Effect.scoped),
      ),
  );

  it.effect("keeps an untagged source untagged and preserves a child's explicit tag", () =>
    withStore((storeLayer) =>
      Effect.gen(function* () {
        const store = yield* ThreadTags.ThreadTags;
        yield* store.inherit({ sourceThreadId: firstThreadId, threadId: secondThreadId });
        yield* store.set({ threadId: firstThreadId, tag: { label: "added later" } });
        yield* store.inherit({ sourceThreadId: firstThreadId, threadId: secondThreadId });
        assert.isUndefined(Option.getOrThrow(yield* snapshot)[secondThreadId]);
        const explicitThreadId = ThreadId.make("explicit");
        yield* store.set({ threadId: explicitThreadId, tag: { label: "explicit" } });
        yield* store.inherit({ sourceThreadId: firstThreadId, threadId: explicitThreadId });
        assert.deepEqual(Option.getOrThrow(yield* snapshot)[explicitThreadId], {
          label: "explicit",
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("does not create tag metadata for a missing, deleted, or self source target", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const store = yield* ThreadTags.ThreadTags;
        const fs = yield* FileSystem.FileSystem;
        for (const threadId of [missingThreadId, deletedThreadId, firstThreadId]) {
          yield* store.inherit({ sourceThreadId: firstThreadId, threadId });
        }
        assert.isFalse(yield* fs.exists(filename));
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("defaults to no overrides without creating a file", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.deepEqual(Option.getOrThrow(yield* snapshot.pipe(Effect.provide(storeLayer))), {});
        assert.isFalse(yield* fs.exists(filename));
      }).pipe(Effect.scoped),
    ),
  );

  it.effect(
    "persists trimmed labels across service restarts and clears only the requested thread",
    () =>
      withStore((storeLayer, filename) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* Effect.gen(function* () {
            const store = yield* ThreadTags.ThreadTags;
            yield* store.set({ threadId: firstThreadId, tag: { label: "  v3 refactor  " } });
            yield* store.set({ threadId: secondThreadId, tag: { label: "backend" } });
          }).pipe(Effect.provide(storeLayer));
          assert.deepEqual(JSON.parse(yield* fs.readFileString(filename)), {
            version: 1,
            threads: { first: { label: "v3 refactor" }, second: { label: "backend" } },
          });
          yield* Effect.gen(function* () {
            const store = yield* ThreadTags.ThreadTags;
            assert.deepEqual(Option.getOrThrow(yield* snapshot), {
              first: { label: "v3 refactor" },
              second: { label: "backend" },
            });
            yield* store.set({ threadId: firstThreadId, tag: null });
            yield* store.set({ threadId: firstThreadId, tag: null });
          }).pipe(Effect.provide(storeLayer));
          assert.deepEqual(JSON.parse(yield* fs.readFileString(filename)).threads, {
            second: { label: "backend" },
          });
        }).pipe(Effect.scoped),
      ),
  );

  it.effect("serializes concurrent writes without dropping either tag", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const store = yield* ThreadTags.ThreadTags;
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.all(
          [
            store.set({ threadId: firstThreadId, tag: { label: "one" } }),
            store.set({ threadId: secondThreadId, tag: { label: "two" } }),
          ],
          { concurrency: "unbounded" },
        );
        assert.deepEqual(JSON.parse(yield* fs.readFileString(filename)).threads, {
          first: { label: "one" },
          second: { label: "two" },
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("persists colors, preserves them for old clients, and publishes explicit resets", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.gen(function* () {
          const store = yield* ThreadTags.ThreadTags;
          yield* store.set({ threadId: firstThreadId, tag: { label: "work", color: "#8b5cf6" } });
        }).pipe(Effect.provide(storeLayer));
        yield* Effect.gen(function* () {
          const store = yield* ThreadTags.ThreadTags;
          const updates = yield* Stream.toQueue(store.changes, { capacity: "unbounded" });
          assert.deepEqual(yield* Queue.take(updates), {
            first: { label: "work", color: "#8b5cf6" },
          });
          yield* store.set({ threadId: firstThreadId, tag: { label: "renamed" } });
          assert.deepEqual(yield* Queue.take(updates), {
            first: { label: "renamed", color: "#8b5cf6" },
          });
          yield* store.set({
            threadId: firstThreadId,
            tag: { label: "renamed", color: "#14b8a6" },
          });
          assert.deepEqual(yield* Queue.take(updates), {
            first: { label: "renamed", color: "#14b8a6" },
          });
          yield* store.set({ threadId: firstThreadId, tag: { label: "renamed", color: null } });
          assert.deepEqual(yield* Queue.take(updates), {
            first: { label: "renamed", color: null },
          });
          yield* store.set({ threadId: firstThreadId, tag: null });
          assert.deepEqual(yield* Queue.take(updates), {});
        }).pipe(Effect.provide(storeLayer));
        assert.deepEqual(JSON.parse(yield* fs.readFileString(filename)).threads, {});
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("streams committed set, update, and clear operations to existing subscribers", () =>
    withStore((storeLayer) =>
      Effect.gen(function* () {
        const store = yield* ThreadTags.ThreadTags;
        const updates = yield* Stream.toQueue(store.changes, { capacity: "unbounded" });
        assert.deepEqual(yield* Queue.take(updates), {});
        yield* store.set({ threadId: firstThreadId, tag: { label: "one" } });
        assert.deepEqual(yield* Queue.take(updates), { first: { label: "one" } });
        yield* store.set({ threadId: firstThreadId, tag: { label: "two" } });
        assert.deepEqual(yield* Queue.take(updates), { first: { label: "two" } });
        yield* store.set({ threadId: firstThreadId, tag: null });
        assert.deepEqual(yield* Queue.take(updates), {});
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("refuses missing or deleted threads without creating overrides", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const store = yield* ThreadTags.ThreadTags;
        const fs = yield* FileSystem.FileSystem;
        for (const threadId of [missingThreadId, deletedThreadId]) {
          const failure = yield* store
            .set({ threadId, tag: { label: "unused" } })
            .pipe(Effect.flip);
          assert.equal(failure.operation, "thread-not-found");
        }
        assert.isFalse(yield* fs.exists(filename));
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("preserves unknown future fields when updating another thread or its label", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
        yield* fs.writeFileString(
          filename,
          JSON.stringify({
            version: 1,
            future: "keep",
            threads: { first: { label: "before", icon: "future-icon" } },
          }),
        );
        const store = yield* ThreadTags.ThreadTags;
        yield* store.set({ threadId: firstThreadId, tag: { label: "after" } });
        yield* store.set({ threadId: secondThreadId, tag: { label: "other" } });
        assert.deepEqual(JSON.parse(yield* fs.readFileString(filename)), {
          version: 1,
          future: "keep",
          threads: { first: { label: "after", icon: "future-icon" }, second: { label: "other" } },
        });
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );

  it.effect("leaves the saved file and published tags intact when an atomic rename fails", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.gen(function* () {
          const store = yield* ThreadTags.ThreadTags;
          yield* store.set({ threadId: firstThreadId, tag: { label: "saved" } });
        }).pipe(Effect.provide(storeLayer));
        const before = yield* fs.readFileString(filename);
        yield* Effect.gen(function* () {
          const store = yield* ThreadTags.ThreadTags;
          const failure = yield* store
            .set({ threadId: firstThreadId, tag: { label: "unsaved" } })
            .pipe(Effect.flip);
          assert.equal(failure.operation, "write");
          assert.deepEqual(Option.getOrThrow(yield* snapshot), { first: { label: "saved" } });
        }).pipe(
          Effect.provide(storeLayer),
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            rename: (source) =>
              Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                  pathOrDescriptor: source,
                }),
              ),
          }),
        );
        assert.equal(yield* fs.readFileString(filename), before);
        const path = yield* Path.Path;
        assert.deepEqual(yield* fs.readDirectory(path.dirname(filename)), ["thread-tags.json"]);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("reports corrupt or unsupported sidecars without replacing them", () =>
    withStore((storeLayer, filename) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
        const store = yield* ThreadTags.ThreadTags;
        for (const contents of ["broken json", '{"version":2,"threads":{}}']) {
          yield* fs.writeFileString(filename, contents);
          const failure = yield* store
            .set({ threadId: firstThreadId, tag: { label: "new" } })
            .pipe(Effect.flip);
          assert.equal(failure.operation, "read");
          assert.equal(yield* fs.readFileString(filename), contents);
        }
      }).pipe(Effect.provide(storeLayer), Effect.scoped),
    ),
  );
});
