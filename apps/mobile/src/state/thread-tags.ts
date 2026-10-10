import { createThreadTagEnvironmentAtoms } from "@t3tools/client-runtime/state/thread-tags";
import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

export const threadTagEnvironment = createThreadTagEnvironmentAtoms(
  connectionAtomRuntime,
  serverEnvironment.configValueAtom,
);
