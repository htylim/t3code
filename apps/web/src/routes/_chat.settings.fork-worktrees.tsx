import { createFileRoute } from "@tanstack/react-router";

import { ForkWorktreesSettings } from "../components/settings/ForkWorktreesSettings";

export const Route = createFileRoute("/_chat/settings/fork-worktrees")({
  component: ForkWorktreesSettings,
});
