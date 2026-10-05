import { createFileRoute } from "@tanstack/react-router";

import { ForkSettings } from "../fork/projectCards/ForkSettings";

export const Route = createFileRoute("/settings/fork")({ component: ForkSettings });
