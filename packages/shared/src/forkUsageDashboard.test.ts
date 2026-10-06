import { ProviderDriverKind, ProviderInstanceConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  forkUsageDashboardExcludedInstanceIds,
  isForkUsageDashboardIncluded,
  withForkUsageDashboardIncluded,
} from "./forkUsageDashboard.ts";

describe("fork usage dashboard preference", () => {
  it.each(["codex", "claudeAgent"])(
    "round-trips %s exclusions through the upstream JSON contract and restores inclusion",
    (driver) => {
      const original: ProviderInstanceConfig = {
        driver: ProviderDriverKind.make(driver),
        displayName: "Personal",
        enabled: true,
        config: { homePath: "~/personal", customModels: [], otherForkOption: 42 },
      };
      const excluded = withForkUsageDashboardIncluded(original, false);
      const jsonCodec = Schema.fromJsonString(ProviderInstanceConfig);
      const persisted = Schema.encodeSync(jsonCodec)(excluded);
      const restored = Schema.decodeSync(jsonCodec)(persisted);

      expect(isForkUsageDashboardIncluded(original)).toBe(true);
      expect(isForkUsageDashboardIncluded(restored)).toBe(false);
      expect(withForkUsageDashboardIncluded(restored, true)).toEqual(original);
      expect(original.config).not.toHaveProperty("forkUsageDashboardIncluded");
    },
  );

  it("ignores malformed preferences and providers without account-specific scanning", () => {
    for (const config of [undefined, null, {}, { forkUsageDashboardIncluded: "false" }]) {
      expect(
        isForkUsageDashboardIncluded({ driver: ProviderDriverKind.make("codex"), config }),
      ).toBe(true);
    }
    expect(
      isForkUsageDashboardIncluded({
        driver: ProviderDriverKind.make("opencode"),
        config: { forkUsageDashboardIncluded: false },
      }),
    ).toBe(true);
  });

  it("keeps the scan dependency stable across unrelated account edits and map ordering", () => {
    const personal: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("codex"),
      config: { forkUsageDashboardIncluded: false },
    };
    const work: ProviderInstanceConfig = { driver: ProviderDriverKind.make("codex") };
    const before = forkUsageDashboardExcludedInstanceIds({ personal, work });
    const after = forkUsageDashboardExcludedInstanceIds({
      work: { ...work, enabled: false },
      personal: { ...personal, displayName: "Renamed" },
    });
    expect(before).toEqual(["personal"]);
    expect(after).toEqual(before);
  });
});
