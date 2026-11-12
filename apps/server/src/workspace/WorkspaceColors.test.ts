import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
import { expect, it, vi } from "@effect/vitest";
import { ProjectId, ThreadId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as WorkspaceColors from "./WorkspaceColors.ts";

const projectId = ProjectId.make("color-project");
const rules = [{ id: "reviews", color: "#f43f5e", prompt: "Code reviews" }];

/** Supply real settings defaults and fake only external persistence and model calls. */
function setup(
  generateColor: NonNullable<
    TextGeneration.TextGeneration["Service"]["generateWorkspaceColor"]
  > = () => Effect.succeed({ color: "#f43f5e" }),
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) {
  const generateWorkspaceColor = vi.fn(generateColor);
  const layer = WorkspaceColors.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest(settings),
        Layer.mock(TextGeneration.TextGeneration)({ generateWorkspaceColor }),
        Layer.mock(ProjectStore.ProjectStoreV2)({
          get: () =>
            Effect.succeedSome({
              projectId,
              title: "acme-api",
              workspaceRoot: "/home/user/acme-api",
              defaultModelSelection: null,
              defaultThreadEnvMode: "local",
              autoPull: false,
              faviconPath: null,
              projectIcon: null,
              scripts: [],
              pinnedAt: null,
              archivedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            }),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
      ),
    ),
  );
  const fileLayer = ServerConfig.layerTest(process.cwd(), { prefix: "workspace-colors-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  return {
    layer: layer.pipe(Layer.provide(fileLayer)),
    colorLayer: layer,
    fileLayer,
    generateWorkspaceColor,
  };
}

it.effect("classifies the first prompt with project context and ignores blank rules", () => {
  const harness = setup();
  return Effect.gen(function* () {
    const colors = yield* WorkspaceColors.WorkspaceColors;
    expect(
      yield* colors.choose({
        projectId,
        message: "Review pull request 42",
        fallbackColor: "#abcdef",
        rules: [...rules, { id: "blank", color: "#3b82f6", prompt: " " }],
      }),
    ).toEqual({ color: "#f43f5e" });
    expect(harness.generateWorkspaceColor.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/home/user/acme-api",
      projectName: "acme-api",
      message: "Review pull request 42",
      fallbackColor: "#abcdef",
      rules,
    });
  }).pipe(Effect.provide(harness.layer));
});

it.effect.each([undefined, "#123456"])(
  "uses fallback %s without a model call when there are no usable rules or prompt",
  (fallbackColor) => {
    const harness = setup();
    return Effect.gen(function* () {
      const colors = yield* WorkspaceColors.WorkspaceColors;
      expect(
        yield* colors.choose({
          projectId,
          message: "Review",
          rules: [],
          ...(fallbackColor ? { fallbackColor } : {}),
        }),
      ).toEqual({
        color: fallbackColor ?? "#808080",
      });
      expect(
        yield* colors.choose({
          projectId,
          message: " ",
          rules,
          ...(fallbackColor ? { fallbackColor } : {}),
        }),
      ).toEqual({
        color: fallbackColor ?? "#808080",
        pending: true,
      });
      expect(harness.generateWorkspaceColor).not.toHaveBeenCalled();
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect.each(["#123456", "#654321"])(
  "uses the configured fallback for a no-match or invalid model color %s",
  (color) => {
    const harness = setup(() => Effect.succeed({ color }));
    return Effect.gen(function* () {
      const colors = yield* WorkspaceColors.WorkspaceColors;
      expect(
        yield* colors.choose({ projectId, message: "Review", rules, fallbackColor: "#123456" }),
      ).toEqual({
        color: "#123456",
      });
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("model failures leave workspace setup usable", () => {
  const harness = setup(
    () =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateWorkspaceColor",
          detail: "Provider unavailable",
        }),
      ),
    { forkWorkspaceColors: { choice: "auto", fallbackColor: "#123456", rules } },
  );
  return Effect.gen(function* () {
    const colors = yield* WorkspaceColors.WorkspaceColors;
    expect(
      yield* colors.choose({ projectId, message: "Review", rules, fallbackColor: "#123456" }),
    ).toEqual({
      color: "#123456",
    });
    yield* colors.initialize({
      projectId,
      threadId: ThreadId.make("unavailable-model"),
      worktreePath: "/home/user/worktrees/unavailable-model",
      message: "Review PR 42",
    });
    const snapshot = yield* colors.stream(projectId).pipe(Stream.runHead);
    expect(Option.getOrThrow(snapshot).colors[0]?.color).toBe("#123456");
  }).pipe(Effect.provide(harness.layer));
});

it.effect("restores unattended colors after restart and preserves reused workspaces", () => {
  const harness = setup(undefined, {
    forkWorkspaceColors: {
      choice: "auto",
      fallbackColor: "#808080",
      rules,
    },
  });
  const input = {
    projectId,
    threadId: ThreadId.make("review-thread"),
    worktreePath: "/home/user/worktrees/review",
    message: "Review PR 42",
  };
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const colors = yield* WorkspaceColors.WorkspaceColors;
      yield* colors.initialize(input);
      yield* colors.initialize({
        ...input,
        threadId: ThreadId.make("reuse-thread"),
        message: "Implement fix",
      });
    }).pipe(Effect.provide(harness.colorLayer));
    const restored = yield* Effect.gen(function* () {
      const colors = yield* WorkspaceColors.WorkspaceColors;
      yield* colors.initialize(input);
      return yield* colors.stream(projectId).pipe(Stream.runHead);
    }).pipe(Effect.provide(harness.colorLayer));
    expect(Option.getOrThrow(restored)).toEqual({
      colors: [
        {
          projectId,
          threadId: input.threadId,
          worktreePath: input.worktreePath,
          color: "#f43f5e",
        },
      ],
    });
    expect(harness.generateWorkspaceColor).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(harness.fileLayer));
});

it.effect("reads existing desktop Auto rules without changing client settings", () => {
  const harness = setup();
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const clientSettingsPath = path.join(stateDir, "client-settings.json");
    const legacy =
      '{"forkDefaultWorkspaceColor":"auto","forkWorkspaceFallbackColor":"#808080","forkColorPickerPrompts":[{"id":"reviews","color":"#f43f5e","prompt":"Code reviews"}]}';
    yield* fs.writeFileString(clientSettingsPath, legacy);
    yield* Effect.gen(function* () {
      const colors = yield* WorkspaceColors.WorkspaceColors;
      yield* colors.initialize({
        projectId,
        threadId: ThreadId.make("legacy-review"),
        worktreePath: "/home/user/worktrees/legacy-review",
        message: "Review PR 42",
      });
    }).pipe(Effect.provide(harness.colorLayer));
    expect(harness.generateWorkspaceColor).toHaveBeenCalledTimes(1);
    expect(yield* fs.readFileString(clientSettingsPath)).toBe(legacy);
  }).pipe(Effect.provide(harness.fileLayer));
});
