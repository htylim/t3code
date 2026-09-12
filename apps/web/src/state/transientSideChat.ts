import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const cleanupTransientSideChatCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "transient-side-chat:cleanup",
  tag: WS_METHODS.transientSideChatCleanup,
});
