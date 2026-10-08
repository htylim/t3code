import { createFileRoute } from "@tanstack/react-router";

import { ForkSettings } from "../components/settings/ForkSettings";

export const Route = createFileRoute("/settings/fork")({
  component: ForkSettings,
});
