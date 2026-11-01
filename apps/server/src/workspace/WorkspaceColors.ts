import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import { type ChooseWorkspaceColorInput } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

/** Resolve colors without letting optional classification prevent workspace creation. */
export class WorkspaceColors extends Context.Service<
  WorkspaceColors,
  {
    readonly choose: (
      input: ChooseWorkspaceColorInput,
    ) => Effect.Effect<{ color: string; pending?: boolean }>;
  }
>()("t3/workspace/WorkspaceColors") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const generation = yield* TextGeneration.TextGeneration;
  const choose = Effect.fn("WorkspaceColors.choose")(function* (input: ChooseWorkspaceColorInput) {
    const fallbackColor = input.fallbackColor?.toLowerCase() ?? "#808080";
    return yield* Effect.gen(function* () {
      const rules = input.rules.filter((rule) => rule.prompt.trim().length > 0);
      const project = Option.getOrNull(yield* projects.get(input.projectId));
      if (!project) return { color: fallbackColor };
      let message = input.message ?? "";
      if (input.threadId) {
        const records = yield* projections.getThreadRecords(input.threadId, ["messages"], {
          messageRoles: ["user"],
        });
        message = records.messages[0]?.text ?? message;
      }
      if (!message.trim()) return { color: fallbackColor, pending: true };
      if (rules.length === 0 || !generation.generateWorkspaceColor) return { color: fallbackColor };
      const settings = resolveProjectSettings(
        yield* settingsService.getSettings,
        input.projectId,
      ).settings;
      const generated = yield* generation.generateWorkspaceColor({
        cwd: project.workspaceRoot,
        projectName: project.title,
        message,
        rules,
        fallbackColor,
        modelSelection: settings.textGenerationModelSelection,
      });
      const color = generated.color.toLowerCase();
      const allowed =
        color === fallbackColor || rules.some((rule) => rule.color.toLowerCase() === color);
      return { color: allowed ? color : fallbackColor };
    }).pipe(
      Effect.timeout("20 seconds"),
      Effect.orElseSucceed(() => ({ color: fallbackColor })),
    );
  });
  return WorkspaceColors.of({ choose });
});

export const layer = Layer.effect(WorkspaceColors, make);
