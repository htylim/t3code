import { expect, it, vi } from "@effect/vitest";
import { ProjectId, TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
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
) {
  const generateWorkspaceColor = vi.fn(generateColor);
  const layer = WorkspaceColors.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettings.layerTest({}),
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
  return { layer, generateWorkspaceColor };
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
  const harness = setup(() =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateWorkspaceColor",
        detail: "Provider unavailable",
      }),
    ),
  );
  return Effect.gen(function* () {
    const colors = yield* WorkspaceColors.WorkspaceColors;
    expect(
      yield* colors.choose({ projectId, message: "Review", rules, fallbackColor: "#123456" }),
    ).toEqual({
      color: "#123456",
    });
  }).pipe(Effect.provide(harness.layer));
});
