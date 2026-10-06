import type { ProviderInstanceConfig } from "@t3tools/contracts";

const INCLUDED_KEY = "forkUsageDashboardIncluded";

/** Claude and Codex have history sources resolved per account. */
export function supportsForkUsageDashboardToggle(driver: string): boolean {
  return driver === "codex" || driver === "claudeAgent";
}

/** Missing or malformed fork preferences keep the upstream inclusion default. */
export function isForkUsageDashboardIncluded(instance: {
  readonly driver: string;
  readonly config?: unknown;
}): boolean {
  if (!supportsForkUsageDashboardToggle(instance.driver)) return true;
  const providerConfig = instance.config;
  if (providerConfig === null || typeof providerConfig !== "object") return true;
  return (providerConfig as Record<string, unknown>)[INCLUDED_KEY] !== false;
}

/** Store only exclusions in the opaque config so upstream schemas stay unchanged. */
export function withForkUsageDashboardIncluded(
  instance: ProviderInstanceConfig,
  included: boolean,
): ProviderInstanceConfig {
  const providerConfig = instance.config;
  const nextProviderConfig: Record<string, unknown> =
    providerConfig !== null && typeof providerConfig === "object"
      ? { ...(providerConfig as Record<string, unknown>) }
      : {};
  if (included) {
    delete nextProviderConfig[INCLUDED_KEY];
  } else {
    nextProviderConfig[INCLUDED_KEY] = false;
  }
  return { ...instance, config: nextProviderConfig };
}

/** Stable scan dependency that ignores account edits unrelated to this preference. */
export function forkUsageDashboardExcludedInstanceIds(
  instances: Readonly<Record<string, ProviderInstanceConfig>>,
): readonly string[] {
  const excludedInstanceIds: string[] = [];
  for (const [instanceId, instance] of Object.entries(instances)) {
    if (!isForkUsageDashboardIncluded(instance)) excludedInstanceIds.push(instanceId);
  }
  return excludedInstanceIds.sort();
}
