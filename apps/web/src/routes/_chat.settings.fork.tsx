import { createFileRoute } from "@tanstack/react-router";

import { ForkSettings } from "../components/settings/ForkSettings";

export const Route = createFileRoute("/_chat/settings/fork")({
  component: ForkSettings,
});
