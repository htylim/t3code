import { useCallback, useMemo, useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useProjectCardStates, type ProjectCardState } from "./preferences";
import {
  buildProjectCardGroups,
  projectCardThreadKey,
  projectCardVisibleThreads,
} from "./projectCards.logic";

/** Share the exact displayed thread order with keyboard navigation and selection. */
export function useProjectCards(input: {
  readonly enabled: boolean;
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly selectedThreadKey: string | null;
  readonly selectedDraftProjectKey: string | null;
  readonly selectedDraftId: string | null;
}) {
  const [cardStates, setCardStates] = useProjectCardStates();
  const selectionKey = input.selectedThreadKey ?? input.selectedDraftId;
  const [selectionVisibility, setSelectionVisibility] = useState({ selectionKey, hidden: false });
  if (selectionVisibility.selectionKey !== selectionKey) {
    setSelectionVisibility({ selectionKey, hidden: false });
  }
  const cards = useMemo(
    () => (input.enabled ? buildProjectCardGroups(input.projects, input.threads) : []),
    [input.enabled, input.projects, input.threads],
  );
  const revealedSelection =
    selectionVisibility.selectionKey !== selectionKey || !selectionVisibility.hidden;
  const visibleThreads = useMemo(
    () =>
      cards.flatMap((card) => {
        const state = cardStates[card.projectKey] ?? "preview";
        const containsSelection =
          card.threads.some((thread) => projectCardThreadKey(thread) === input.selectedThreadKey) ||
          card.projectKey === input.selectedDraftProjectKey;
        return projectCardVisibleThreads(
          card.threads,
          state,
          input.selectedThreadKey,
          revealedSelection && containsSelection,
        );
      }),
    [cardStates, cards, input.selectedDraftProjectKey, input.selectedThreadKey, revealedSelection],
  );
  const setCardState = useCallback(
    (projectKey: string, state: ProjectCardState) => {
      setCardStates((previousStates) => ({ ...previousStates, [projectKey]: state }));
      const selectedCard = cards.find((card) => card.projectKey === projectKey);
      const containsSelection =
        selectedCard?.threads.some(
          (thread) => projectCardThreadKey(thread) === input.selectedThreadKey,
        ) || projectKey === input.selectedDraftProjectKey;
      if (containsSelection)
        setSelectionVisibility({ selectionKey, hidden: state === "collapsed" });
    },
    [cards, input.selectedDraftProjectKey, input.selectedThreadKey, selectionKey, setCardStates],
  );
  return { cards, cardStates, visibleThreads, setCardState, revealedSelection };
}
