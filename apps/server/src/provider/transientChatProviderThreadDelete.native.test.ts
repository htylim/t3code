import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CodexSettings, OpenCodeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { withCodexAppServerClient } from "./Layers/CodexProvider.ts";
import { OpenCodeRuntime, OpenCodeRuntimeLive } from "./opencodeRuntime.ts";
import { deleteTransientChatProviderThread } from "./transientChatProviderThreadDelete.ts";

// Explicit opt-in: requires installed CLIs. Creates no turns and uses only
// disposable provider homes; no credentials or real history are needed.
const enabled = process.env.T3_TEST_NATIVE_TRANSIENT_DELETION === "1";
const layer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));
const codexConfig = Schema.decodeSync(CodexSettings)({});
const openCodeConfig = Schema.decodeSync(OpenCodeSettings)({});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeChild = Schema.decodeUnknownEffect(
  Schema.Struct({
    thread: Schema.Struct({
      source: Schema.Struct({
        subAgent: Schema.Struct({
          thread_spawn: Schema.Struct({ parent_thread_id: Schema.String }),
        }),
      }),
    }),
  }),
);
const rootId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";

describe.skipIf(!enabled)("Installed providers: transient deletion", () => {
  it.layer(layer, { excludeTestServices: true })((it) => {
    it.effect(
      "Codex refuses an empty rollout instead of treating unreadable history as absent",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
          const directory = path.join(home, "sessions", "2026", "09", "12");
          yield* fs.makeDirectory(directory, { recursive: true });
          const file = path.join(directory, `rollout-2026-09-12T12-00-00-${rootId}.jsonl`);
          yield* fs.writeFileString(file, "");
          const error = yield* Effect.flip(
            deleteTransientChatProviderThread({
              provider: "codex",
              providerSessionId: rootId,
              cwd: home,
              config: { ...codexConfig, homePath: home },
              allowMissing: true,
            }),
          );
          assert.equal(error.reason, "provider-error");
          assert.include(error.message, "empty");
          assert.isTrue(yield* fs.exists(file));
        }),
    );

    for (const childState of ["none", "active", "archived"] as const) {
      it.effect(
        `Codex ${childState === "none" ? "deletes a standalone rollout" : `refuses a parent with an ${childState} child`}`,
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const home = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
            const cwd = path.join(home, "project");
            yield* fs.makeDirectory(cwd);
            const directory = path.join(home, "sessions", "2026", "09", "12");
            yield* fs.makeDirectory(directory, { recursive: true });
            const seed = Effect.fn("seedCodexRollout")(function* (id: string, parent?: string) {
              const file = path.join(directory, `rollout-2026-09-12T12-00-00-${id}.jsonl`);
              yield* fs.writeFileString(
                file,
                [
                  {
                    timestamp: "2026-09-12T12:00:00.000Z",
                    type: "session_meta",
                    payload: {
                      id,
                      timestamp: "2026-09-12T12:00:00.000Z",
                      cwd,
                      originator: "t3code_test",
                      cli_version: "0.154.0",
                      model_provider: "openai",
                      source: parent
                        ? { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } }
                        : "cli",
                    },
                  },
                  {
                    timestamp: "2026-09-12T12:00:00.000Z",
                    type: "event_msg",
                    payload: {
                      type: "user_message",
                      message: "Disposable transcript fixture.",
                      images: [],
                      local_images: [],
                      text_elements: [],
                    },
                  },
                ]
                  .map((entry) => encodeJson(entry))
                  .join("\n") + "\n",
              );
              return file;
            });
            const root = yield* seed(rootId);
            const other = yield* seed(otherId);
            const child = childState !== "none" ? yield* seed(childId, rootId) : undefined;
            let childPath = child;
            if (child) {
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const { client } = yield* withCodexAppServerClient({
                    binaryPath: codexConfig.binaryPath,
                    homePath: home,
                    cwd,
                  });
                  // Check the real provider recognized the lineage in the rollout fixture.
                  const read = yield* client.raw.request("thread/read", { threadId: childId });
                  const parsed = yield* decodeChild(read);
                  assert.equal(parsed.thread.source.subAgent.thread_spawn.parent_thread_id, rootId);
                  if (childState === "archived") {
                    yield* client.raw.request("thread/archive", { threadId: childId });
                    childPath = path.join(home, "archived_sessions", path.basename(child));
                  }
                }),
              );
              const error = yield* Effect.flip(
                deleteTransientChatProviderThread({
                  provider: "codex",
                  providerSessionId: childId,
                  cwd,
                  config: { ...codexConfig, homePath: home },
                }),
              );
              assert.equal(error.reason, "unsafe-session");
            }
            const outcome = yield* deleteTransientChatProviderThread({
              provider: "codex",
              providerSessionId: rootId,
              cwd,
              config: { ...codexConfig, homePath: home },
            }).pipe(Effect.result);
            if (childPath) {
              assert.equal(outcome._tag, "Failure");
              if (outcome._tag === "Failure") {
                assert.equal(outcome.failure.reason, "unsafe-session");
                assert.include(outcome.failure.message, "descendants");
              }
              assert.isTrue(yield* fs.exists(root));
              assert.isTrue(yield* fs.exists(childPath));
            } else {
              if (outcome._tag === "Failure") return yield* outcome.failure;
              assert.isFalse(yield* fs.exists(root));
              assert.equal(
                yield* deleteTransientChatProviderThread({
                  provider: "codex",
                  providerSessionId: rootId,
                  cwd,
                  config: { ...codexConfig, homePath: home },
                  allowMissing: true,
                }),
                "already-absent",
              );
              const { client } = yield* withCodexAppServerClient({
                binaryPath: codexConfig.binaryPath,
                homePath: home,
                cwd,
              });
              const read = yield* client.raw
                .request("thread/read", { threadId: rootId })
                .pipe(Effect.result);
              assert.equal(read._tag, "Failure");
            }
            assert.isTrue(yield* fs.exists(other));
          }),
      );
    }

    it.effect(
      "OpenCode deletes standalone history, refuses both sides of a parent-child pair",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const temporary = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
          const runtime = yield* OpenCodeRuntime;
          const environment = {
            ...process.env,
            XDG_DATA_HOME: path.join(temporary, "data"),
            XDG_STATE_HOME: path.join(temporary, "state"),
            XDG_CONFIG_HOME: path.join(temporary, "config"),
            XDG_CACHE_HOME: path.join(temporary, "cache"),
            OPENCODE_CONFIG_CONTENT: "{}",
            OPENCODE_DISABLE_MODELS_FETCH: "true",
          };
          const server = yield* runtime.connectToOpenCodeServer({
            binaryPath: openCodeConfig.binaryPath,
            directory: temporary,
            environment,
          });
          const client = runtime.createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: temporary,
            ...(server.serverPassword !== undefined
              ? { serverPassword: server.serverPassword }
              : {}),
          });
          const config = {
            ...openCodeConfig,
            serverUrl: server.url,
            serverPassword: server.serverPassword ?? "",
          };
          const create = Effect.fn("createOpenCodeFixture")(function* (parentID?: string) {
            const response = yield* Effect.tryPromise(() =>
              client.session.create(
                {
                  directory: temporary,
                  title: "Disposable transient test",
                  ...(parentID ? { parentID } : {}),
                },
                { throwOnError: true },
              ),
            );
            assert.isDefined(response.data);
            return response.data!.id;
          });
          const target = yield* create();
          const parent = yield* create();
          const child = yield* create(parent);
          const remove = (providerSessionId: string, allowMissing = false) =>
            deleteTransientChatProviderThread({
              provider: "opencode",
              providerSessionId,
              allowMissing,
              cwd: temporary,
              config,
              environment,
            });
          yield* remove(target);
          assert.equal(yield* remove(target, true), "already-absent");
          for (const id of [parent, child]) {
            const error = yield* Effect.flip(remove(id));
            assert.equal(error.reason, "unsafe-session");
            const kept = yield* Effect.tryPromise(() =>
              client.session.get({ sessionID: id }, { throwOnError: true }),
            );
            assert.equal(kept.data?.id, id);
          }
        }),
    );
  });
});
