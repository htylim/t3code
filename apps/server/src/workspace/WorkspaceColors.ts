import {
  WorkspaceColorSnapshot,
  type WorkspaceColorRecord,
  type ProjectId,
  type ThreadId,
  ClientSettingsSchema,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
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
    /** Classify a new workspace without delaying its agent turn. Saved choices survive restarts. */
    readonly initialize: (input: {
      projectId: ProjectId;
      threadId: ThreadId;
      worktreePath: string;
      message: string;
    }) => Effect.Effect<void>;
    readonly stream: (projectId: ProjectId) => Stream.Stream<typeof WorkspaceColorSnapshot.Type>;
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
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const directory = path.join(stateDir, "fork");
  const colorsPath = path.join(directory, "workspace-colors.json");
  const decodeSnapshot = Schema.decodeEffect(Schema.fromJsonString(WorkspaceColorSnapshot));
  const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(WorkspaceColorSnapshot));
  const saved = yield* fs.readFileString(colorsPath).pipe(
    Effect.flatMap(decodeSnapshot),
    Effect.orElseSucceed(() => ({ colors: [] })),
  );
  const records = yield* SubscriptionRef.make<ReadonlyArray<WorkspaceColorRecord>>(saved.colors);
  const writeLock = yield* Semaphore.make(1);
  const initializeLocks = new Map<string, Semaphore.Semaphore>();
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
  const initialize = Effect.fn("WorkspaceColors.initialize")(
    function* (input: {
      projectId: ProjectId;
      threadId: ThreadId;
      worktreePath: string;
      message: string;
    }) {
      if (!input.message.trim()) return;
      const previous = yield* SubscriptionRef.get(records);
      if (
        previous.some(
          (record) =>
            record.threadId === input.threadId ||
            (record.projectId === input.projectId && record.worktreePath === input.worktreePath),
        )
      )
        return;
      let preferences = (yield* settingsService.getSettings).forkWorkspaceColors;
      if (!preferences) {
        // Installed desktop versions stored these rules on the device before unattended launches used them.
        const legacy = yield* fs
          .readFileString(path.join(stateDir, "client-settings.json"))
          .pipe(
            Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(ClientSettingsSchema))),
            Effect.option,
          );
        if (Option.isNone(legacy)) return;
        preferences = {
          choice: legacy.value.forkDefaultWorkspaceColor,
          fallbackColor: legacy.value.forkWorkspaceFallbackColor,
          rules: legacy.value.forkColorPickerPrompts,
        };
      }
      if (preferences.choice !== "auto") return;
      const selected = yield* choose({
        projectId: input.projectId,
        message: input.message.slice(0, 16000),
        rules: preferences.rules,
        fallbackColor: preferences.fallbackColor,
      });
      const record = {
        threadId: input.threadId,
        projectId: input.projectId,
        worktreePath: input.worktreePath,
        color: selected.color,
      };
      yield* Effect.gen(function* () {
        const colors = [...(yield* SubscriptionRef.get(records)), record];
        yield* fs.makeDirectory(directory, { recursive: true });
        const document = yield* encodeSnapshot({ colors });
        yield* fs.writeFileString(`${colorsPath}.tmp`, document);
        yield* fs.rename(`${colorsPath}.tmp`, colorsPath);
        yield* SubscriptionRef.set(records, colors);
      }).pipe(writeLock.withPermit);
    },
    (effect, input) => {
      const key = `${input.projectId}:${input.worktreePath}`;
      let lock = initializeLocks.get(key);
      if (!lock) {
        lock = Semaphore.makeUnsafe(1);
        initializeLocks.set(key, lock);
      }
      return lock.withPermit(effect);
    },
    Effect.catch((cause) => Effect.logWarning("Workspace color could not be saved", { cause })),
  );

  return WorkspaceColors.of({
    choose,
    initialize,
    stream: (projectId) =>
      SubscriptionRef.changes(records).pipe(
        Stream.map((colors) => ({
          colors: colors.filter((record) => record.projectId === projectId),
        })),
        Stream.changes,
      ),
  });
});

export const layer = Layer.effect(WorkspaceColors, make);
