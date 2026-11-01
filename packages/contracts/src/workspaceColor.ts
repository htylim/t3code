import * as Schema from "effect/Schema";
import { ProjectId, ThreadId } from "./baseSchemas.ts";

/** Colors offered by the workspace picker and Random mode. */
export const WORKSPACE_COLOR_PRESETS = [
  { label: "Gray", color: "#808080" },
  { label: "Violet", color: "#8b5cf6" },
  { label: "Blue", color: "#3b82f6" },
  { label: "Cyan", color: "#06b6d4" },
  { label: "Teal", color: "#14b8a6" },
  { label: "Green", color: "#22c55e" },
  { label: "Amber", color: "#f59e0b" },
  { label: "Orange", color: "#f97316" },
  { label: "Rose", color: "#f43f5e" },
] as const;

export const WorkspaceColorHex = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));
export const WorkspaceColorChoice = Schema.Union([
  WorkspaceColorHex,
  Schema.Literals(["random", "auto"]),
]);
export const WorkspaceColorMode = Schema.Literals(["random", "auto"]);
export type WorkspaceColorMode = typeof WorkspaceColorMode.Type;
export const WorkspaceColorRule = Schema.Struct({
  id: Schema.String,
  color: WorkspaceColorHex,
  prompt: Schema.String.check(Schema.isMaxLength(4000)),
});
export type WorkspaceColorRule = typeof WorkspaceColorRule.Type;
export const ChooseWorkspaceColorInput = Schema.Struct({
  projectId: ProjectId,
  message: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16000))),
  threadId: Schema.optionalKey(ThreadId),
  rules: Schema.Array(WorkspaceColorRule).check(Schema.isMaxLength(100)),
  fallbackColor: Schema.optionalKey(WorkspaceColorHex),
});
export type ChooseWorkspaceColorInput = typeof ChooseWorkspaceColorInput.Type;
export const ChooseWorkspaceColorResult = Schema.Struct({
  color: Schema.String,
  pending: Schema.optionalKey(Schema.Boolean),
});
