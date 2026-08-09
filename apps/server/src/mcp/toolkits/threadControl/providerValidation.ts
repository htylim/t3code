import {
  isProviderAvailable,
  type ModelSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

export type ModelSelectionValidation =
  | {
      readonly ok: true;
      readonly provider: ServerProvider;
      readonly model: ServerProviderModel;
    }
  | {
      readonly ok: false;
      readonly code: "provider_unavailable" | "invalid_model_selection";
      readonly message: string;
    };

export function validateModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): ModelSelectionValidation {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (
    provider === undefined ||
    !isProviderAvailable(provider) ||
    !provider.installed ||
    !provider.enabled ||
    provider.status === "error" ||
    provider.status === "disabled"
  ) {
    return {
      ok: false,
      code: "provider_unavailable",
      message: `Provider instance '${selection.instanceId}' is not currently usable.`,
    };
  }

  const model = provider.models.find((candidate) => candidate.slug === selection.model);
  if (model === undefined) {
    return {
      ok: false,
      code: "invalid_model_selection",
      message: `Model '${selection.model}' is not available from provider instance '${selection.instanceId}'.`,
    };
  }

  const options = selection.options ?? [];
  const seen = new Set<string>();
  const descriptors = new Map(
    (model.capabilities?.optionDescriptors ?? []).map((descriptor) => [descriptor.id, descriptor]),
  );
  for (const option of options) {
    if (seen.has(option.id)) {
      return {
        ok: false,
        code: "invalid_model_selection",
        message: `Model option '${option.id}' was supplied more than once.`,
      };
    }
    seen.add(option.id);
    const descriptor = descriptors.get(option.id);
    if (descriptor === undefined) {
      return {
        ok: false,
        code: "invalid_model_selection",
        message: `Model option '${option.id}' is not supported by '${selection.model}'.`,
      };
    }
    if (descriptor.type === "boolean") {
      if (typeof option.value !== "boolean") {
        return {
          ok: false,
          code: "invalid_model_selection",
          message: `Model option '${option.id}' requires a Boolean value.`,
        };
      }
      continue;
    }
    if (
      typeof option.value !== "string" ||
      !descriptor.options.some((choice) => choice.id === option.value)
    ) {
      return {
        ok: false,
        code: "invalid_model_selection",
        message: `Model option '${option.id}' must use one of its advertised choice IDs.`,
      };
    }
  }

  return { ok: true, provider, model };
}
