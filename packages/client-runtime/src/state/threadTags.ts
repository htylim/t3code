import {
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import type { ThreadTags } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Share one live sidecar subscription per environment across all visible thread labels. */
export function createThreadTagEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  configValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>,
) {
  const snapshots = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "fork:thread-tags:snapshots",
    tag: WS_METHODS.threadTagsSubscribe,
  });
  const supportedAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get) => get(configValueAtom(environmentId))?.environment.capabilities.threadTags === true,
    ),
  );
  const snapshotAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ThreadTags | null => {
      if (!get(supportedAtom(environmentId))) return null;
      return Option.getOrNull(AsyncResult.value(get(snapshots({ environmentId, input: {} }))));
    }),
  );
  const failedAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      if (!get(supportedAtom(environmentId))) return false;
      return get(snapshots({ environmentId, input: {} }))._tag === "Failure";
    }),
  );
  const labelAtom = Atom.family((ref: ScopedThreadRef) =>
    Atom.make((get) => get(snapshotAtom(ref.environmentId))?.[ref.threadId]?.label ?? null),
  );
  const colorAtom = Atom.family((ref: ScopedThreadRef) =>
    Atom.make((get) => get(snapshotAtom(ref.environmentId))?.[ref.threadId]?.color ?? null),
  );
  const set = createEnvironmentRpcCommand(runtime, {
    label: "fork:thread-tags:set",
    tag: WS_METHODS.threadTagsSet,
  });
  return { supportedAtom, snapshotAtom, failedAtom, labelAtom, colorAtom, set };
}
