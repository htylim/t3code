import { createThreadTagEnvironmentAtoms } from "@t3tools/client-runtime/state/thread-tags";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "./server";
import type { EnvironmentId } from "@t3tools/contracts";

export const threadTagEnvironment = createThreadTagEnvironmentAtoms(
  connectionAtomRuntime,
  serverEnvironment.configValueAtom,
);

/** Check the destination environment before offering a fork-only action. */
export function readThreadTagsSupported(environmentId: EnvironmentId): boolean {
  return appAtomRegistry.get(threadTagEnvironment.supportedAtom(environmentId));
}
