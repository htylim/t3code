import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

const PROJECT_CARDS_ENABLED_KEY = "t3code:fork:project-cards:enabled";
const PROJECT_CARD_STATES_KEY = "t3code:fork:project-cards:states";

export const ProjectCardState = Schema.Literals(["collapsed", "preview", "expanded"]);
export type ProjectCardState = typeof ProjectCardState.Type;
const ProjectCardStates = Schema.Record(Schema.String, ProjectCardState);
const EMPTY_CARD_STATES: Record<string, ProjectCardState> = {};

/** Store the opt-in separately from app settings and server state. */
export function useProjectCardsEnabled() {
  return useLocalStorage(PROJECT_CARDS_ENABLED_KEY, false, Schema.Boolean);
}

/** Remember project visibility on this client without modifying its database. */
export function useProjectCardStates() {
  return useLocalStorage(PROJECT_CARD_STATES_KEY, EMPTY_CARD_STATES, ProjectCardStates);
}
