import {
  DEFAULT_SOFT_PILL_COLOR,
  SOFT_PILL_COLOR_PRESETS,
} from "@t3tools/client-runtime/soft-pill-colors";
import type { WorkspaceColorMode } from "@t3tools/contracts";

/** Resolve Random once; Auto starts gray until the first prompt is available. */
export function createWorkspaceColorSelection(choice: string): {
  color: string;
  colorMode?: WorkspaceColorMode;
} {
  if (choice === "random") {
    const preset =
      SOFT_PILL_COLOR_PRESETS[Math.floor(Math.random() * SOFT_PILL_COLOR_PRESETS.length)]!;
    return { color: preset.color, colorMode: "random" };
  }
  if (choice === "auto") return { color: DEFAULT_SOFT_PILL_COLOR, colorMode: "auto" };
  return { color: choice };
}
