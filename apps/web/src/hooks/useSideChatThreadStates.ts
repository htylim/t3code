import { useMemo } from "react";

import { selectSideChatThreadStates, useRightPanelStore } from "../rightPanelStore";

/** Compute sidebar roles once per panel-state change, independent of the current route. */
export function useSideChatThreadStates() {
  const byThreadKey = useRightPanelStore((state) => state.byThreadKey);
  return useMemo(() => selectSideChatThreadStates(byThreadKey), [byThreadKey]);
}
