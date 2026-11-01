import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as CodexTextGeneration from "../../apps/server/src/textGeneration/CodexTextGeneration.ts";
import * as ServerConfig from "../../apps/server/src/config.ts";
import { workspaceColorCases, workspaceColorRules } from "./cases.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    model: { type: "string" },
    out: { type: "string" },
    home: { type: "string" },
    shadow: { type: "string" },
    case: { type: "string" },
  },
});
if (!values.model || !values.out || !values.home || !values.shadow)
  throw new Error("Use --model <model> --out <file> --home <Codex home> --shadow <shadow home>.");
const decodeSettings = Schema.decodeEffect(CodexSettings);
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const model = values.model;
const outputFile = values.out;
const homePath = values.home;
const shadowHomePath = values.shadow;

await Effect.runPromise(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-color-evaluation-" });
    const settings = yield* decodeSettings({ homePath, shadowHomePath });
    const generation = yield* CodexTextGeneration.makeCodexTextGeneration(settings);
    if (!generation.generateWorkspaceColor)
      throw new Error("Provider does not support workspace colors.");
    const results = [];
    const scenarios = workspaceColorCases.filter(
      (scenario) => !values.case || scenario.id === values.case,
    );
    if (scenarios.length === 0) throw new Error(`Unknown color case: ${values.case}`);
    for (const scenario of scenarios) {
      const generated = yield* generation.generateWorkspaceColor({
        cwd,
        projectName: scenario.projectName,
        message: scenario.message,
        rules: workspaceColorRules,
        fallbackColor: "fallbackColor" in scenario ? scenario.fallbackColor : "#808080",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex_personal"),
          model,
          options: [{ id: "reasoningEffort", value: "low" }],
        },
      });
      results.push({
        id: scenario.id,
        expected: scenario.expected,
        actual: generated.color,
        passed: generated.color === scenario.expected,
      });
    }
    yield* fileSystem.writeFileString(outputFile, yield* encodeReport({ model, results }));
    const passed = results.filter((scenario) => scenario.passed).length;
    yield* Effect.log(`${passed}/${results.length} color cases passed. Results: ${outputFile}`);
    if (passed !== results.length) throw new Error("Workspace color evaluation failed.");
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-color-evaluation-state-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  ),
);
