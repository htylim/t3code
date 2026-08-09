import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { validateModelSelection } from "./providerValidation.ts";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex_work"),
  driver: ProviderDriverKind.make("codex"),
  displayName: "Work Codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-08T12:00:00.000Z",
  availability: "available",
  models: [
    {
      slug: "gpt-5.6-sol",
      name: "GPT-5.6 Sol",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
          { id: "fast", label: "Fast", type: "boolean" },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
  supportsThreadFork: false,
};

const selection = (options?: ModelSelection["options"]): ModelSelection => ({
  instanceId: provider.instanceId,
  model: "gpt-5.6-sol",
  ...(options === undefined ? {} : { options }),
});

describe("validateModelSelection", () => {
  it("accepts the exact advertised select and Boolean option vocabulary", () => {
    expect(
      validateModelSelection(
        [provider],
        selection([
          { id: "effort", value: "high" },
          { id: "fast", value: true },
        ]),
      ).ok,
    ).toBe(true);
  });

  it("rejects unavailable, disabled, missing, and errored provider instances", () => {
    for (const unavailable of [
      { ...provider, availability: "unavailable" as const, installed: false, enabled: false },
      { ...provider, enabled: false },
      { ...provider, installed: false },
      { ...provider, status: "error" as const },
    ]) {
      expect(validateModelSelection([unavailable], selection())).toMatchObject({
        ok: false,
        code: "provider_unavailable",
      });
    }
    expect(validateModelSelection([], selection())).toMatchObject({
      ok: false,
      code: "provider_unavailable",
    });
  });

  it("rejects missing models, unknown or duplicate options, and invalid values", () => {
    const invalidSelections: ReadonlyArray<ModelSelection> = [
      { ...selection(), model: "missing" },
      selection([{ id: "unknown", value: true }]),
      selection([
        { id: "fast", value: true },
        { id: "fast", value: false },
      ]),
      selection([{ id: "fast", value: "yes" }]),
      selection([{ id: "effort", value: "maximum" }]),
      selection([{ id: "effort", value: true }]),
    ];
    for (const invalid of invalidSelections) {
      expect(validateModelSelection([provider], invalid)).toMatchObject({
        ok: false,
        code: "invalid_model_selection",
      });
    }
  });
});
