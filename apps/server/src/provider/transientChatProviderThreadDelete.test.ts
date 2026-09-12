import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ClaudeSettings, CodexSettings, OpenCodeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

import { OpenCodeRuntimeLive } from "./opencodeRuntime.ts";
import { spawnAndCollect } from "./providerSnapshot.ts";
import { deleteTransientChatProviderThread } from "./transientChatProviderThreadDelete.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const missingId = "33333333-3333-4333-8333-333333333333";
const layer = OpenCodeRuntimeLive.pipe(Layer.provideMerge(NodeServices.layer));
const claudeConfig = Schema.decodeSync(ClaudeSettings)({});
const codexConfig = Schema.decodeSync(CodexSettings)({});
const openCodeConfig = Schema.decodeSync(OpenCodeSettings)({});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeFork = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ sessionId: Schema.String })),
);

const fixture = Effect.fn("fixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const cwd = path.join(temporary, "project");
  yield* fs.makeDirectory(cwd);
  const seed = Effect.fn("seed")(function* (home: string, id = sessionId) {
    const project = path.join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    yield* fs.makeDirectory(project, { recursive: true });
    const transcript = path.join(project, `${id}.jsonl`);
    yield* fs.writeFileString(
      transcript,
      encodeJson({
        type: "user",
        sessionId: id,
        uuid: otherId,
        parentUuid: null,
        isSidechain: false,
        cwd,
        timestamp: "2026-09-12T12:00:00.000Z",
        version: "2.1.269",
        message: { role: "user", content: "Disposable transient session test." },
      }) + "\n",
    );
    return { transcript, project };
  });
  const home = path.join(temporary, "claude-home");
  const target = yield* seed(home);
  return { fs, path, temporary, cwd, seed, home, ...target };
});

it.layer(layer)("Transient provider deletion entry point", (it) => {
  it.effect("deletes a real Claude SDK transcript and preserves an unrelated root", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const other = yield* f.seed(f.home, otherId);
      const before = yield* f.fs.readFileString(other.transcript);
      yield* deleteTransientChatProviderThread({
        provider: "claudeAgent",
        providerSessionId: sessionId,
        cwd: f.cwd,
        config: { ...claudeConfig, homePath: f.home },
      });
      assert.isFalse(yield* f.fs.exists(f.transcript));
      assert.equal(
        yield* deleteTransientChatProviderThread({
          provider: "claudeAgent",
          providerSessionId: sessionId,
          cwd: f.cwd,
          config: { ...claudeConfig, homePath: f.home },
          allowMissing: true,
        }),
        "already-absent",
      );
      assert.equal(yield* f.fs.readFileString(other.transcript), before);
    }),
  );

  it.effect("retry does not mistake a corrupt Claude transcript for missing history", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.fs.writeFileString(f.transcript, "corrupt transcript\n");
      const error = yield* Effect.flip(
        deleteTransientChatProviderThread({
          provider: "claudeAgent",
          providerSessionId: sessionId,
          cwd: f.cwd,
          config: { ...claudeConfig, homePath: f.home },
          allowMissing: true,
        }),
      );
      assert.equal(error.reason, "invalid-target");
      assert.equal(yield* f.fs.readFileString(f.transcript), "corrupt transcript\n");
    }),
  );

  it.effect("rejects Claude roots with subagents and preserves all their files", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const subagents = f.path.join(f.project, sessionId, "subagents");
      yield* f.fs.makeDirectory(subagents, { recursive: true });
      const child = f.path.join(subagents, "agent-child.jsonl");
      yield* f.fs.writeFileString(child, "{}\n");
      const before = yield* f.fs.readFileString(f.transcript);
      const error = yield* Effect.flip(
        deleteTransientChatProviderThread({
          provider: "claudeAgent",
          providerSessionId: sessionId,
          cwd: f.cwd,
          config: { ...claudeConfig, homePath: f.home },
        }),
      );
      assert.equal(error.reason, "unsafe-session");
      assert.equal(yield* f.fs.readFileString(f.transcript), before);
      assert.equal(yield* f.fs.readFileString(child), "{}\n");
    }),
  );

  it.effect("deleting a real Claude SDK fork preserves its source transcript", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const before = yield* f.fs.readFileString(f.transcript);
      const workerPath = yield* f.path.fromFileUrl(
        new URL("../claudeHistoryWorker.ts", import.meta.url),
      );
      const result = yield* spawnAndCollect(
        process.execPath,
        ChildProcess.make(
          process.execPath,
          [workerPath, "forkSession", sessionId, encodeJson({ dir: f.cwd })],
          { env: { ...process.env, CLAUDE_CONFIG_DIR: f.home, ELECTRON_RUN_AS_NODE: "1" } },
        ),
      );
      assert.equal(result.code, 0, result.stderr);
      const fork = yield* decodeFork(result.stdout);
      const forkFile = f.path.join(f.project, `${fork.sessionId}.jsonl`);
      assert.isTrue(yield* f.fs.exists(forkFile));
      yield* deleteTransientChatProviderThread({
        provider: "claudeAgent",
        providerSessionId: fork.sessionId,
        cwd: f.cwd,
        config: { ...claudeConfig, homePath: f.home },
      });
      assert.isFalse(yield* f.fs.exists(forkFile));
      assert.equal(yield* f.fs.readFileString(f.transcript), before);
    }),
  );

  it.effect(
    "isolates concurrent deletions in custom provider homes without changing process.env",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const otherHome = f.path.join(f.temporary, "second-home");
        const second = yield* f.seed(otherHome);
        const survivor = yield* f.seed(otherHome, otherId);
        const beforeConfigDir = process.env.CLAUDE_CONFIG_DIR;
        yield* Effect.all(
          [
            deleteTransientChatProviderThread({
              provider: "claudeAgent",
              providerSessionId: sessionId,
              cwd: f.cwd,
              config: { ...claudeConfig, homePath: f.home },
              environment: { ...process.env, CLAUDE_CONFIG_DIR: otherHome },
            }),
            deleteTransientChatProviderThread({
              provider: "claudeAgent",
              providerSessionId: sessionId,
              cwd: f.cwd,
              config: claudeConfig,
              environment: { ...process.env, CLAUDE_CONFIG_DIR: otherHome },
            }),
          ],
          { concurrency: "unbounded" },
        );
        assert.isFalse(yield* f.fs.exists(f.transcript));
        assert.isFalse(yield* f.fs.exists(second.transcript));
        assert.isTrue(yield* f.fs.exists(survivor.transcript));
        assert.equal(process.env.CLAUDE_CONFIG_DIR, beforeConfigDir);
      }),
  );

  it.effect("deleting in one Claude home leaves the same ID in another home intact", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const otherHome = f.path.join(f.temporary, "second-home");
      const other = yield* f.seed(otherHome);
      yield* deleteTransientChatProviderThread({
        provider: "claudeAgent",
        providerSessionId: sessionId,
        cwd: f.cwd,
        config: { ...claudeConfig, homePath: f.home },
      });
      assert.isTrue(yield* f.fs.exists(other.transcript));
    }),
  );

  it.effect("reports a missing Claude root without changing other history", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const error = yield* Effect.flip(
        deleteTransientChatProviderThread({
          provider: "claudeAgent",
          providerSessionId: missingId,
          cwd: f.cwd,
          config: { ...claudeConfig, homePath: f.home },
        }),
      );
      assert.equal(error.reason, "invalid-target");
      assert.isTrue(yield* f.fs.exists(f.transcript));
    }),
  );

  for (const [provider, config] of [
    ["codex", codexConfig],
    ["claudeAgent", claudeConfig],
    ["opencode", openCodeConfig],
  ] as const) {
    // A malformed target must fail before launching any provider or worker.
    it.effect(`rejects invalid ${provider} native IDs`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          deleteTransientChatProviderThread({
            provider,
            config,
            providerSessionId: "../../other-session",
            cwd: "/project",
          } as Parameters<typeof deleteTransientChatProviderThread>[0]),
        );
        assert.equal(error.reason, "invalid-target");
      }),
    );
  }
  it.effect("rejects a relative project directory", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        deleteTransientChatProviderThread({
          provider: "claudeAgent",
          config: claudeConfig,
          providerSessionId: sessionId,
          cwd: "relative",
        }),
      );
      assert.equal(error.reason, "invalid-target");
    }),
  );
  it.effect("returns a typed error if the Codex executable is unavailable", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const error = yield* Effect.flip(
        deleteTransientChatProviderThread({
          provider: "codex",
          providerSessionId: sessionId,
          cwd: f.cwd,
          config: {
            ...codexConfig,
            binaryPath: f.path.join(f.temporary, "missing-codex"),
            homePath: f.temporary,
          },
        }),
      );
      assert.equal(error.reason, "provider-error");
    }),
  );
});
